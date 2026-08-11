/*
  eslint-disable max-lines, sonarjs/cognitive-complexity, complexity, no-sync
*/

const EventEmitter = require('events').EventEmitter
const { finished, Readable } = require('stream')
const _ = require('./utils')
const { scheduleMicrotask, scheduleNextTurn } = require('./scheduler')
const { DATA, END, ERROR, dataFrame, endFrame, errorFrame, isDataValue } = require('./protocol')
const { forkContext } = require('./context')

const signalActive = Symbol('exstream signal active')

function getErrorMessage(value) {
  if (value && value.message !== void 0) return String(value.message)
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value)
    if (serialized !== void 0) return serialized
  } catch {
    // Fall back to the standard string conversion for cyclic objects.
  }
  return String(value)
}

class ExstreamError extends Error {
  constructor(e, exstreamInput) {
    super(getErrorMessage(e))
    if (e && e.exstreamError) {
      return e
    } else if (e instanceof Error) {
      e.exstreamError = true
      e.exstreamInput = exstreamInput
      return e
    }
    if (e && (typeof e === 'object' || typeof e === 'function')) Object.assign(this, e)
    if (e && e.stack) this.stack = e.stack
    this.exstreamError = true
    this.exstreamInput = exstreamInput
    this.reason = e
  }
}

class BufferOverflowError extends Error {
  constructor(limit) {
    super(`Exstream buffer limit of ${limit} exceeded`)
    this.name = 'BufferOverflowError'
    this.code = 'EXSTREAM_BUFFER_OVERFLOW'
    this.limit = limit
  }
}

class Exstream extends EventEmitter {
  __exstream__ = true
  writable = true
  readable = true

  #state = 'idle'
  #startPromise = null
  #abortReason = null
  #failing = false
  #aborting = false
  #abortController = null
  #signalAbortReason = signalActive

  #resumedAtLeastOnce = false
  paused = true
  pausedFromOutside = true
  pausedFromInside = false

  #nilPushed = false

  #buffer = []
  #buffered = 0
  #peakBuffered = 0
  #dropped = 0
  #bufferLimit = Infinity
  #overflowPolicy = 'error'
  #sourceData = null
  #generator = null

  #consumeFn = null
  #consumeSyncFn = null
  #activeContext = void 0
  #nextCalled = true
  #nextGenCalled = true
  #consumers = []
  #observers = []
  #observedSource = null
  #contextBoundary = false
  #autostart = true
  #synchronous = true

  #destroyers = []

  get state() {
    return this.#state
  }

  get ended() {
    return this.#state === 'ended' || this.#state === 'destroyed' || this.#state === 'aborted'
  }

  get abortReason() {
    return this.#abortReason
  }

  get signal() {
    if (!this.#abortController) {
      this.#abortController = new AbortController()
      if (this.#signalAbortReason !== signalActive) {
        this.#abortController.abort(this.#signalAbortReason)
      }
    }
    return this.#abortController.signal
  }

  get buffered() {
    return this.#buffered
  }

  get peakBuffered() {
    return this.#peakBuffered
  }

  get dropped() {
    return this.#dropped
  }

  get bufferLimit() {
    return this.#bufferLimit
  }

  get overflowPolicy() {
    return this.#overflowPolicy
  }

  constructor(xs, options = null) {
    super()
    this.#configureBuffer(options)
    this.#configureAbortSignal(options)
    if (this.ended) return
    if (!xs) {
      return this
    } else if (_.isExstream(xs)) {
      return xs
    } else if (_.isNodeStream(xs)) {
      this.#pipeReadable(xs)
    } else if (_.isIterable(xs)) {
      this.#sourceData = xs[Symbol.iterator]()
    } else if (_.isAsyncIterable(xs)) {
      this.#pipeReadable(Readable.from(xs))
    } else if (_.isPromise(xs)) {
      return new Exstream([xs]).resolve()
    } else if (_.isFunction(xs)) {
      this.#synchronous = false
      this.#generator = xs
    } else {
      throw Error(
        'error creating exstream: invalid source. source can be one of: iterable, ' +
          'async iterable, exstream function, a promise, a node readable stream',
      )
    }
  }

  #configureBuffer = (options) => {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return
    let limit
    try {
      limit = options.bufferLimit === void 0 ? Infinity : Number(options.bufferLimit)
    } catch {
      limit = NaN
    }
    if (limit !== Infinity && (!Number.isInteger(limit) || limit < 0)) {
      throw Error('bufferLimit must be a non-negative integer or Infinity')
    }
    const overflow = options.overflow === void 0 ? 'error' : options.overflow
    if (!['error', 'drop-oldest', 'drop-newest'].includes(overflow)) {
      throw Error('overflow must be one of: error, drop-oldest, drop-newest')
    }
    if (overflow !== 'error' && limit === Infinity) {
      throw Error('best-effort overflow requires a finite bufferLimit')
    }
    this.#bufferLimit = limit
    this.#overflowPolicy = overflow
  }

  #configureAbortSignal = (options) => {
    const signal = options && typeof options === 'object' ? options.signal : void 0
    if (signal === void 0) return
    if (
      !signal ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function'
    ) {
      throw Error('signal must be an AbortSignal')
    }
    const abortFromSignal = () => this.abort(signal.reason)
    if (signal.aborted) abortFromSignal()
    else {
      signal.addEventListener('abort', abortFromSignal, { once: true })
      this.#destroyers.push(() => signal.removeEventListener('abort', abortFromSignal))
    }
  }

  #pipeReadable = (xs) => {
    this.#synchronous = false
    xs.pipe(this)
    this.#addOnceListener('error', xs, (e) => {
      // sometimes e is not an instance of Error, nobody knows why
      this.write(new ExstreamError(e))
      scheduleNextTurn(() => this.end())
    })
    this.once('end', () => xs.destroy())
  }

  #addOnceListener = (event, target, handler) => {
    target.once(event, handler)
    this.#destroyers.push(() => target.off(event, handler))
  }

  write(x) {
    if (this.#nilPushed) throw Error('Cannot write to stream after nil')
    return this._write(x)
  }

  writeData(value) {
    if (this.#nilPushed) throw Error('Cannot write to stream after nil')
    return this._writeData(value)
  }

  #enqueue = (type, value, input, fatal, context) => {
    if (type === END) {
      const frame = endFrame
      this.#buffer.push(frame)
      return true
    }
    if (this.#buffered === this.#bufferLimit) {
      if (this.#overflowPolicy === 'error') throw new BufferOverflowError(this.#bufferLimit)
      this.#dropped++
      if (this.#overflowPolicy === 'drop-newest' || this.#bufferLimit === 0) return false
      this.#buffer.shift()
      this.#buffered--
    }
    const frame =
      type === DATA ? dataFrame(value, context) : errorFrame(value, input, fatal, context)
    this.#buffer.push(frame)
    this.#buffered++
    this.#peakBuffered = Math.max(this.#peakBuffered, this.#buffered)
    return true
  }

  _write(x, skipBackPressure = false) {
    if (x && typeof x === 'object' && isDataValue(x))
      return this._writeData(x.value, skipBackPressure)
    if (x === _.nil)
      return this.#writeControlRecord(END, void 0, void 0, false, void 0, skipBackPressure)
    if (_.isError(x))
      return this.#writeControlRecord(ERROR, x, x.exstreamInput, false, void 0, skipBackPressure)
    return this._writeData(x, skipBackPressure)
  }

  _writeData(value, skipBackPressure = false, context) {
    if (this.paused && !skipBackPressure) {
      this.#enqueue(DATA, value, void 0, false, context)
    } else if (this.#consumeSyncFn) {
      if (context === void 0) this.#consumeSyncFn(void 0, value, this.#push)
      else this.#consumeSyncContext(void 0, value, context)
    } else if (this.#consumeFn) {
      this.#consumeAsyncRecord(void 0, value, context)
    } else {
      this.#sendData(value, context)
    }

    return !this.paused || skipBackPressure
  }

  #writeControlRecord = (type, value, input, fatal, context, skipBackPressure = false) => {
    if (type === END) this.#nilPushed = true
    const err = type === ERROR ? value : void 0
    const x = type === END ? _.nil : null

    if (this.paused && !skipBackPressure) {
      this.#enqueue(type, value, input, fatal, context)
    } else if (this.#consumeSyncFn) {
      if (context === void 0) this.#consumeSyncFn(err, x, this.#push)
      else this.#consumeSyncContext(err, x, context)
    } else if (this.#consumeFn) {
      this.#consumeAsyncRecord(err, x, context)
    } else {
      this.#sendControl(type, value, input, fatal, context)
    }

    return !this.paused || skipBackPressure
  }

  #consumeSyncContext(err, x, context) {
    this.#activeContext = context
    if (this.#consumeSyncFn.length >= 4) this.#consumeSyncFn(err, x, this.#contextPush, context)
    else this.#consumeSyncFn(err, x, this.#contextPush)
    this.#activeContext = void 0
  }

  #consumeAsyncRecord(err, x, context) {
    this.#nextCalled = false
    let syncNext = true
    const next = () => {
      this.#nextCalled = true
      if (this.paused && !syncNext) scheduleMicrotask(() => this.resume(true))
    }
    const push = context === void 0 ? this.#push : this.#contextualPush(context)
    if (context !== void 0 && this.#consumeFn.length >= 5)
      this.#consumeFn(err, x, push, next, context)
    else this.#consumeFn(err, x, push, next)
    syncNext = false
    if (!this.#nextCalled) this.pause(true)
  }

  #contextualPush =
    (context) =>
    (err, x, nextContext = context) =>
      this.#push(err, x, nextContext)

  #contextPush = (err, x, context = this.#activeContext) => this.#push(err, x, context)

  #push = (err, x, context) => {
    if (err) this.#sendControl(ERROR, err, err.exstreamInput, false, context)
    else if (x === _.nil) this.#sendControl(END, void 0, void 0, false)
    else this.#sendData(x, context)
  }

  #sendData = (value, context) => {
    const consumers = this.#consumers
    const observers = this.#observers
    if (context === void 0) {
      for (let i = 0, len = consumers.length; i < len; i++) {
        consumers[i]._writeData(value)
      }
      for (let i = 0, len = observers.length; i < len; i++) {
        observers[i].#writeObservedData(value)
      }
      return
    }
    for (let i = 0, len = consumers.length; i < len; i++) {
      const consumer = consumers[i]
      const nextContext = consumer.#contextBoundary
        ? forkContext(context, consumer.signal)
        : context
      consumer._writeData(value, false, nextContext)
    }
    for (let i = 0, len = observers.length; i < len; i++) {
      const observer = observers[i]
      observer.#writeObservedData(value, forkContext(context, observer.signal))
    }
  }

  #sendControl = (type, value, input, fatal, context) => {
    if (type === END) scheduleMicrotask(() => this.end())
    // i store it locally because this array could be filtered
    // during the loop if one consumer ends (for ex. it can happen withtake or slice)
    const consumers = this.#consumers
    if (type === ERROR && !this.#consumers.length) this.emit('error', value)
    if (context === void 0) {
      for (let i = 0, len = consumers.length; i < len; i++) {
        consumers[i].#writeControlRecord(type, value, input, fatal)
      }
      const observers = this.#observers
      for (let i = 0, len = observers.length; i < len; i++) {
        observers[i].#writeObservedControl(type, value, input, fatal)
      }
      return
    }
    for (let i = 0, len = consumers.length; i < len; i++) {
      const consumer = consumers[i]
      const nextContext = consumer.#contextBoundary
        ? forkContext(context, consumer.signal)
        : context
      consumer.#writeControlRecord(type, value, input, fatal, nextContext)
    }
    const observers = this.#observers
    for (let i = 0, len = observers.length; i < len; i++) {
      const observer = observers[i]
      observer.#writeObservedControl(
        type,
        value,
        input,
        fatal,
        forkContext(context, observer.signal),
      )
    }
  }

  #writeObservedData = (value, context) => {
    if (this.ended || this.#state === 'ending') return
    try {
      if (context === void 0) this._writeData(value)
      else this._writeData(value, false, context)
    } catch (error) {
      this.abort(error)
    }
  }

  #writeObservedControl = (type, value, input, fatal, context) => {
    if (this.ended || this.#state === 'ending') return
    try {
      this.#writeControlRecord(type, value, input, fatal, context)
    } catch (error) {
      this.abort(error)
    }
  }

  start() {
    if (this.ended || this.#state === 'ending') return Promise.resolve()
    if (this.#startPromise) return this.#startPromise
    // A next turn guarantees that .pipe() has resumed the source stream.
    this.#startPromise = new Promise((resolve) =>
      scheduleNextTurn(() => {
        if (this.ended || this.#state === 'ending') {
          resolve()
          return
        }
        this.#state = 'running'
        this.#autostart = true
        this.#checkBackPressure()
        resolve()
      }),
    )
    return this.#startPromise
  }

  #terminate = (terminalState, discardBuffer = false, propagateUpstream = true) => {
    if (this.ended || this.#state === 'ending') return
    this.#state = 'ending'
    if (discardBuffer) {
      this.#buffer = []
      this.#buffered = 0
    }
    if (!this.#nilPushed) this.#writeControlRecord(END, void 0, void 0, false)
    if (this.paused) this.#flushBuffer(true)
    this.#state = terminalState
    if (terminalState === 'aborted') this.emit('abort', this.#abortReason)
    if (this.readable) this.emit('end')
    while (this.#consumers.length) this.#removeConsumer(this.#consumers[0])
    const source = this.source
    if (source) {
      source.#removeConsumer(this)
      if (propagateUpstream && source.#consumers.length === 0) {
        if (terminalState === 'aborted') source.abort(this.#abortReason)
        else source.destroy()
      }
    }
    if (this.#observedSource) this.#observedSource.#removeObserver(this)
    this.#generator = null
    this.#sourceData = null
    this.removeAllListeners()
    this.#destroyers.forEach((x) => x())
    this.#destroyers = []
    for (const observer of this.#observers) observer.#observedSource = null
    this.#observers = []
  }

  end() {
    this.#terminate('ended')
  }

  destroy() {
    return this.ended ? void 0 : this.#destroyActive()
  }

  #destroyActive = () => {
    const reason = Error('The stream was destroyed')
    reason.name = 'AbortError'
    this.#cancelSignal(reason)
    this.#terminate('destroyed', true)
  }

  abort(reason) {
    if (this.ended || this.#state === 'ending') return
    if (reason === void 0) {
      reason = Error('The operation was aborted')
      reason.name = 'AbortError'
    }
    return this.#abortDownstream(reason)
  }

  #abortDownstream = (reason) => (this.ended ? void 0 : this.#abortUnlessInProgress(reason))

  #abortUnlessInProgress = (reason) => (this.#aborting ? void 0 : this.#propagateAbort(reason))

  #propagateAbort = (reason) => {
    this.#aborting = true
    this.#cancelSignal(reason)
    this.#emitErrorIfHandled(reason)
    const consumers = this.#consumers
    const observers = this.#observers
    for (let i = 0, len = consumers.length; i < len; i++) {
      consumers[i].#abortDownstream(reason)
    }
    for (let i = 0, len = observers.length; i < len; i++) {
      observers[i].#abortDownstream(reason)
    }
    this.#abortReason = reason
    this.#terminate('aborted', true)
  }

  #cancelSignal = (reason) => {
    if (this.#signalAbortReason !== signalActive) return false
    this.#signalAbortReason = reason
    return this.#abortController ? this.#abortController.abort(reason) : true
  }

  fail(reason, input) {
    const error = new ExstreamError(reason, input)
    error.exstreamFatal = true
    let root = this
    while (root.source) root = root.source
    return root.#failDownstream(error, input)
  }

  #failDownstream = (error, input) =>
    this.ended ? void 0 : this.#failUnlessInProgress(error, input)

  #failUnlessInProgress = (error, input) =>
    this.#failing ? void 0 : this.#propagateFailure(error, input)

  #emitErrorIfHandled = (error) => (this.listenerCount('error') ? this.emit('error', error) : false)

  #propagateFailure = (error, input) => {
    this.#failing = true
    this.#emitErrorIfHandled(error)
    this.emit('fatal', error, input)
    const consumers = this.#consumers
    const observers = this.#observers
    for (let i = 0, len = consumers.length; i < len; i++) {
      consumers[i].#failDownstream(error, input)
    }
    for (let i = 0, len = observers.length; i < len; i++) {
      observers[i].#failDownstream(error, input)
    }
    this.#cancelSignal(error)
    this.#abortReason = error
    this.#terminate('aborted', true, false)
  }

  #flushBuffer = (force = false) => {
    if (!this.#buffer.length) return
    let i = 0
    for (const len = this.#buffer.length; i < len; i++) {
      // write can synchronously pause the stream in case of back pressure
      const frame = this.#buffer[i]
      const wrote =
        frame.type === DATA
          ? this._writeData(frame.value, force, frame.context)
          : this.#writeControlRecord(
              frame.type,
              frame.error,
              frame.input,
              frame.fatal,
              frame.context,
              force,
            )
      if (!wrote) break
    }
    const removed = this.#buffer.slice(0, i + 1)
    this.#buffer = this.#buffer.slice(i + 1)
    this.#buffered -= removed.filter((frame) => frame.type !== END).length
  }

  #consumeSourceData = () => {
    let nextVal
    do {
      try {
        nextVal = this.#sourceData.next()
      } catch (e) {
        // es6 generator fatal error. Must end the stream
        this.write(e)
        this.end()
        return
      }
      if (!nextVal.done) this.write(nextVal.value)
      else this.end()
    } while (!this.#nilPushed && !this.paused)
  }

  #consumeGenerator = () => {
    let syncNext = true
    const next = (otherStream) => {
      this.#nextGenCalled = true
      let me = this
      if (otherStream) {
        otherStream = new Exstream(otherStream)
        otherStream.#consumers = this.#consumers
        otherStream.#consumers.forEach((x) => {
          x.source = otherStream
        })
        otherStream.#resumedAtLeastOnce = true
        otherStream.pausedFromInside = true
        otherStream.pausedFromOutside = false
        otherStream.#buffer = this.#buffer
        otherStream.#buffered = this.#buffered
        otherStream.#peakBuffered = Math.max(this.#peakBuffered, otherStream.#peakBuffered)
        otherStream.#dropped += this.#dropped
        otherStream.#bufferLimit = this.#bufferLimit
        otherStream.#overflowPolicy = this.#overflowPolicy
        this.#buffer = []
        this.#buffered = 0
        otherStream.#synchronous = false
        this.#consumers = []
        this.destroy()
        me = otherStream
      }
      if (me.paused && (!syncNext || otherStream)) scheduleNextTurn(() => me.resume(true))
    }

    const w = (x) => {
      this.write(x)
      if (x === _.nil) next()
    }

    do {
      this.#nextGenCalled = false
      syncNext = true
      this.#generator(w, next)
      syncNext = false
      if (!this.#nextGenCalled) this.pause(true)
    } while (!this.paused && !this.#nilPushed)
  }

  pause(fromInside = false) {
    this.paused = true
    if (fromInside) this.pausedFromInside = true
    else this.pausedFromOutside = true
    if (this.source) this.source.pause()
  }

  resume(fromInside = false) {
    if (fromInside) this.pausedFromInside = false
    else this.pausedFromOutside = false
    if (this.pausedFromInside || this.pausedFromOutside) return
    if (!this.#autostart || !this.#nextCalled || !this.#nextGenCalled || !this.paused) return
    if (this.ended || this.#state === 'ending') return

    this.#resumedAtLeastOnce = true
    this.#state = 'running'
    this.paused = false
    this.#flushBuffer() // This can pause the stream again if the consumers are slow
    if (this.paused) return

    if (this.#sourceData) {
      this.#consumeSourceData() // This can pause the stream again if the consumers are slow
    } else if (this.#generator) {
      this.#consumeGenerator() // This can pause the stream again if the consumers are slow
    }

    if (this.paused) return
    if (!this.source) this.emit('drain')
    else this.source.#checkBackPressure()
  }

  #checkBackPressure = () => {
    if (!this.#consumers.length) return this.pause()
    for (let i = 0, len = this.#consumers.length; i < len; i++) {
      if (this.#consumers[i].paused) return this.pause()
    }
    this.resume()
  }

  consume(fn) {
    this.#synchronous = false
    const res = new Exstream()
    res.#consumeFn = fn
    this.#addConsumer(res)
    return res
  }

  consumeSync(fn) {
    const res = new Exstream()
    res.#consumeSyncFn = fn
    this.#addConsumer(res)
    return res
  }

  pull(fn) {
    const _pull = (fn) => {
      const s2 = this.consumeSync((err, x) => {
        this.#removeConsumer(s2)
        fn(err, x)
      })
      s2.resume()
    }

    if (fn) _pull(fn)
    else
      return new Promise((resolve, reject) => {
        _pull((err, x) => {
          if (err) reject(err)
          else if (x === _.nil) resolve(_.nil)
          else resolve(x)
        })
      })
  }

  each(fn) {
    const s2 = this.consumeSync((err, x, push) => {
      if (err) {
        ;(this.endOfChain || this).emit('error', err)
      } else if (x === _.nil) {
        push(null, _.nil)
      } else {
        fn(x)
      }
    })
    s2.resume()
  }

  #addConsumer = (s, skipCheck = false) => {
    const realSource = this.endOfChain || this
    if (!skipCheck && realSource.#consumers.length) {
      throw Error(
        'This stream has already been transformed or consumed. Please ' +
          'fork() or observe() the stream if you want to perform ' +
          'parallel transformations.',
      )
    }
    s.source = realSource
    realSource.#consumers.push(s)
    realSource.#checkBackPressure()
  }

  #removeConsumer = (s) => {
    this.#consumers = this.#consumers.filter((c) => c !== s)
    s.source = null
    this.#checkBackPressure()
  }

  #removeObserver = (observer) => {
    this.#observers = this.#observers.filter((candidate) => candidate !== observer)
    observer.#observedSource = null
  }

  pipe(dest, options = {}) {
    let nextCallback
    const drainCallback = () => {
      if (nextCallback) {
        nextCallback()
        nextCallback = null
      }
    }
    this.#synchronous = false
    if (_.isExstream(dest) || _.isExstreamPipeline(dest)) return this.through(dest)
    const canClose = dest !== process.stdout && dest !== process.stderr && options.end !== false
    const end = canClose ? dest.end : () => ({})
    const s = this.consume((err, x, push, next) => {
      if (x === _.nil) {
        dest.off('drain', drainCallback)
        scheduleMicrotask(() => {
          end.call(dest)
          if (!canClose) s.end()
        })
      } else if (err) {
        // A next turn is needed to exit from a promise context.
        scheduleNextTurn(() => {
          dest.emit('error', err)
          next()
        })
      } else if (!dest.write(x)) {
        nextCallback = next
      } else {
        next()
      }
    })
    dest.on('drain', drainCallback)
    s.#destroyers.push(() => dest.off('drain', drainCallback))
    const stopWatching = finished(dest, { cleanup: true, error: false }, () => s.end())
    s.#destroyers.push(stopWatching)
    dest.emit('pipe', this)
    scheduleNextTurn(() => s.resume())
    return dest
  }

  fork(disableAutostart = false) {
    if (this.#resumedAtLeastOnce)
      throw Error("this stream is already started. you can't fork it anymore")
    this.#synchronous = false
    this.#autostart = false
    if (!disableAutostart) scheduleMicrotask(() => this.start())
    const res = new Exstream()
    res.#contextBoundary = true
    this.#addConsumer(res, true)
    return res
  }

  observe(options = null) {
    const res = new Exstream(null, options)
    res.#contextBoundary = true
    res.#observedSource = this
    this.#observers.push(res)
    return res
  }

  // eslint-disable-next-line max-statements, max-lines-per-function
  through(target, { writable = false } = {}) {
    if (!target) return this
    else if (_.isExstream(target)) {
      const findParent = (x) => (x.source ? findParent(x.source) : x)
      this.#addConsumer(findParent(target))
      return target
    } else if (_.isExstreamPipeline(target)) {
      const pipelineInstance = target.generateStream()
      this.#addConsumer(pipelineInstance)
      return pipelineInstance
    } else if (_.isNodeStream(target) && !writable) {
      this.#synchronous = false
      this.pipe(target)
      return new Exstream(target)
    } else if (_.isNodeStream(target) && writable) {
      this.#synchronous = false
      this.pipe(target)
      const s = new Exstream()
      s.readable = false
      s.source = this
      s.resume()
      s.#addOnceListener('error', target, (e) => {
        s.write(e)
        scheduleNextTurn(() => s.end())
      })
      s.#addOnceListener('finish', target, () => {
        s.emit('finish')
        scheduleNextTurn(() => s.destroy())
      })
      s.#addOnceListener('close', target, () => {
        s.emit('close')
        scheduleNextTurn(() => s.destroy())
      })
      return s
    } else if (_.isFunction(target)) {
      return target(this)
    }
    throw Error(
      'error in .through(). you must pass a non consumed' +
        'exstream instance, a pipeline or a node stream',
    )
  }

  merge(parallelism = Infinity, preserveOrder = false) {
    parallelism = _.asPositiveInteger(parallelism, true)
    if (parallelism === null) {
      throw Error('error in .merge(). parallelism must be a positive integer or Infinity')
    }
    this.#synchronous = false

    const merged = new Exstream()
    merged.setMaxListeners(parallelism * 2 + 1)
    merged.#synchronous = false

    const pipeline = preserveOrder
      ? new Exstream().resolve(parallelism, preserveOrder).flatten()
      : new Exstream().errors((err) => merged.write(err)).resolve(parallelism, preserveOrder)

    const ss = this.map((subS) => {
      if (!_.isExstream(subS)) throw Error('.merge() can merge ONLY exstream instances')
      if (preserveOrder) return subS.#toRecordArray()
      return new Promise((resolve) => {
        let nextCallback
        let fatalInProgress = false
        // eslint-disable-next-line sonarjs/no-identical-functions
        const drainCallback = () => {
          if (nextCallback) {
            nextCallback()
            nextCallback = null
          }
        }
        const subS2 = subS.consume((err, x, push, next, context) => {
          if (x === _.nil) {
            // eslint-disable-next-line no-use-before-define
            merged.off('end', endListener)
            merged.off('drain', drainCallback)
            resolve()
          } else if (
            !(err
              ? merged.#writeControlRecord(ERROR, err, err.exstreamInput, false, context)
              : context === void 0
                ? merged._writeData(x)
                : merged._writeData(x, false, context))
          ) {
            nextCallback = next
          } else {
            next()
          }
        })
        subS2.once('fatal', (error, input) => {
          fatalInProgress = true
          merged.fail(error, input)
        })
        const endListener = () => {
          if (!fatalInProgress) subS2.destroy()
        }
        merged.on('drain', drainCallback)
        merged.once('end', endListener)
        subS2.resume()
      })
    }).through(pipeline)

    if (preserveOrder)
      return ss.consumeSync((err, frame, push) => {
        if (err) push(err)
        else if (frame === _.nil) push(null, _.nil)
        else push(null, frame.value, frame.context)
      })
    const stopCoordinator = () => ss.destroy()
    merged.once('end', stopCoordinator)
    ss.once('end', () => {
      merged.off('end', stopCoordinator)
      merged.end()
    }).resume()
    return merged
  }

  #toRecordArray = () => {
    const records = []
    return new Promise((resolve, reject) => {
      const sink = this.consumeSync((err, x, push, context) => {
        if (err) reject(err)
        else if (x === _.nil) {
          if (sink.source) sink.source.#removeConsumer(sink)
          resolve(records)
        } else records.push(dataFrame(x, context))
      })
      sink.once('error', reject)
      sink.resume()
    })
  }

  value() {
    const res = this.values()
    if (_.isPromise(res)) {
      return res.then((result) => {
        if (result.length > 1)
          throw Error('this stream has emitted more than 1 value. use .values() instad of .value()')
        return result[0]
      })
    } else if (res.length > 1) {
      throw Error('this stream has emitted more than 1 value. use .values() instad of .value()')
    } else {
      return res[0]
    }
  }

  values() {
    let curr = this
    let isSync = this.#synchronous
    while (isSync && curr.source) {
      curr = curr.source
      isSync = isSync && curr.#synchronous
    }
    if (!isSync) {
      return this.toPromise()
    }
    const res = []
    /* v8 ignore next 5 -- V8 does not attribute this synchronous private callback. */
    this.consumeSync((err, x, push) => {
      if (err) throw err
      else if (x === _.nil) push(null, _.nil)
      else res.push(x)
    }).resume()
    return res
  }
}

module.exports = {
  BufferOverflowError,
  Exstream,
  ExstreamError,
}