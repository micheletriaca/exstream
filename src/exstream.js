const _ = require('./utils')
const { EventHub } = require('./event-hub.js')
const { runtime } = require('./runtime.js')
const { scheduleMicrotask, scheduleNextTurn } = require('./scheduler')
const { DATA, END, ERROR, dataFrame, endFrame, errorFrame, isDataValue } = require('./protocol')
const { forkContext } = require('./context')
const { annotateError } = require('./error-info.js')

const signalActive = Symbol('exstream signal active')
const noCancel = () => undefined

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
  constructor(e, exstreamInput, info) {
    super(getErrorMessage(e))
    if (e && e.exstreamError) {
      annotateError(e, info)
      return e
    } else if (e instanceof Error) {
      e.exstreamError = true
      e.exstreamInput = exstreamInput
      annotateError(e, info)
      return e
    }
    if (e && (typeof e === 'object' || typeof e === 'function')) Object.assign(this, e)
    if (e && e.stack) this.stack = e.stack
    this.exstreamError = true
    this.exstreamInput = exstreamInput
    this.reason = e
    annotateError(this, info)
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

class Exstream extends EventHub {
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
    } else if (runtime.isWebReadableStream(xs)) {
      this.#pipeWebReadable(xs)
    } else if (_.isIterable(xs)) {
      this.#sourceData = xs[Symbol.iterator]()
    } else if (_.isAsyncIterable(xs)) {
      this.#pipeAsyncIterable(xs)
    } else if (_.isPromise(xs)) {
      return new Exstream([xs]).mapAsync((value) => value)
    } else if (_.isFunction(xs)) {
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
    xs.pipe(this)
    this.#addOnceListener('error', xs, (e) => {
      // sometimes e is not an instance of Error, nobody knows why
      this.write(new ExstreamError(e, void 0, { origin: 'source', stage: 'read' }))
      scheduleNextTurn(() => this.end())
    })
    this.once('end', () => xs.destroy())
  }

  #pipeAsyncIterable = (iterable) => {
    const iterator = iterable[Symbol.asyncIterator]()
    let cancelled = false
    this.#generator = (write, next) => {
      /* v8 ignore next -- Destruction removes the generator before it can be invoked again. */
      if (cancelled) return
      void (async () => {
        try {
          const item = await iterator.next()
          if (cancelled) return
          if (item.done) write(_.nil)
          else {
            write(item.value)
            next()
          }
        } catch (error) {
          write(new ExstreamError(error, void 0, { origin: 'source', stage: 'iterate' }))
          write(_.nil)
        }
      })()
    }
    this.#destroyers.push(() => {
      cancelled = true
      if (typeof iterator.return === 'function') Promise.resolve(iterator.return()).catch(() => {})
    })
  }

  #pipeWebReadable = (readable) => {
    const reader = readable.getReader()
    let cancelled = false
    this.#generator = (write, next) => {
      /* v8 ignore next -- Destruction removes the generator before it can be invoked again. */
      if (cancelled) return
      void (async () => {
        try {
          const { done, value } = await reader.read()
          if (cancelled) return
          if (done) write(_.nil)
          else {
            write(value)
            next()
          }
        } catch (error) {
          if (cancelled) return
          write(new ExstreamError(error, void 0, { origin: 'source', stage: 'read' }))
          write(_.nil)
        }
      })()
    }
    this.#destroyers.push(() => {
      cancelled = true
      Promise.resolve(reader.cancel(this.signal.reason))
        .catch(() => {})
        .finally(() => reader.releaseLock())
    })
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
    if (_.isError(x)) {
      if (!x.exstreamError) {
        x = new ExstreamError(x, x.exstreamInput, { origin: 'source', stage: 'source' })
      }
      return this.#writeControlRecord(ERROR, x, x.exstreamInput, false, void 0, skipBackPressure)
    }
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

  _writeError(error, context, skipBackPressure = false) {
    return this.#writeControlRecord(
      ERROR,
      error,
      error.exstreamInput,
      false,
      context,
      skipBackPressure,
    )
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
    if (context === void 0) {
      this.#consumeFn(err, x, push, next)
    } else {
      this.#activeContext = context
      try {
        if (this.#consumeFn.length >= 5) this.#consumeFn(err, x, push, next, context)
        else this.#consumeFn(err, x, push, next)
      } finally {
        this.#activeContext = void 0
      }
    }
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
    annotateError(reason, { origin: 'lifecycle', stage: 'destroy' })
    this.#cancelSignal(reason)
    this.#terminate('destroyed', true)
  }

  abort(reason) {
    if (this.ended || this.#state === 'ending') return
    if (reason === void 0) {
      reason = Error('The operation was aborted')
      reason.name = 'AbortError'
    }
    annotateError(reason, { origin: 'lifecycle', stage: 'abort' })
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
    const error = new ExstreamError(reason, input, { origin: 'operator', stage: 'fail' })
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
    this.pause(true)
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
        this.write(new ExstreamError(e, void 0, { origin: 'source', stage: 'iterate' }))
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
        this.#consumers = []
        this.destroy()
        me = otherStream
      }
      if (me.paused && (!syncNext || otherStream)) scheduleNextTurn(() => me.resume(true))
    }

    const w = (x) => {
      if (this.ended || this.#nilPushed) return false
      const wrote = this.write(x)
      if (x === _.nil) next()
      return wrote
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

  get _recordContext() {
    return this.#activeContext
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

  pipeTo(destination, options = {}) {
    if (options === null) options = {}
    if (typeof options !== 'object' || Array.isArray(options)) {
      return Promise.reject(Error('error in .pipeTo(). options must be an object'))
    }
    const signal = options.signal
    if (
      signal !== void 0 &&
      (!signal ||
        typeof signal.aborted !== 'boolean' ||
        typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function')
    ) {
      return Promise.reject(Error('error in .pipeTo(). signal must be an AbortSignal'))
    }
    if (runtime.isWebWritableStream(destination)) {
      return this.#pipeWebWritable(destination, options).then(() => undefined)
    }
    if (!destination || typeof destination.write !== 'function' || !runtime.finished) {
      return Promise.reject(
        Error('error in .pipeTo(). destination must be a Node writable or WritableStream'),
      )
    }
    return this.#pipeNodeWritable(destination, options)
  }

  #pipeNodeWritable = (destination, options) =>
    new Promise((resolve, reject) => {
      let settled = false
      let sourceEnded = false
      let nextCallback
      let pendingWrites = 0
      let sink
      let stopWatching = () => {}
      const canClose =
        !runtime.isStandardOutput(destination) && options.end !== false && !options.preventClose
      const canAbort = !runtime.isStandardOutput(destination) && !options.preventAbort

      const drain = () => {
        const next = nextCallback
        nextCallback = null
        if (next) next()
      }
      const abortFromSignal = () => {
        annotateError(options.signal.reason, { origin: 'lifecycle', stage: 'abort' })
        fail(options.signal.reason)
      }
      const cleanup = () => {
        destination.off('drain', drain)
        stopWatching()
        if (options.signal !== void 0) {
          options.signal.removeEventListener('abort', abortFromSignal)
        }
      }
      const abortDestination = () => {
        if (canAbort && typeof destination.destroy === 'function' && !destination.destroyed) {
          destination.destroy()
        }
      }
      const succeed = () => {
        if (settled) return
        settled = true
        cleanup()
        sink.end()
        resolve()
      }
      const fail = (error, info) => {
        if (settled) return
        settled = true
        annotateError(error, info)
        cleanup()
        abortDestination()
        sink.abort(error)
        reject(error)
      }
      const writeCompleted = (error) => {
        pendingWrites--
        if (error) {
          fail(error, { origin: 'sink', stage: 'write' })
        } else if (sourceEnded && !canClose && pendingWrites === 0) {
          succeed()
        }
      }

      sink = this.consume((error, value, push, next) => {
        if (settled) return
        if (error) {
          fail(error)
        } else if (value === _.nil) {
          sourceEnded = true
          if (!canClose) {
            if (pendingWrites === 0) succeed()
            return
          }
          try {
            destination.end()
          } catch (reason) {
            fail(reason, { origin: 'sink', stage: 'close' })
          }
        } else {
          try {
            if (canClose) {
              if (!destination.write(value)) nextCallback = next
              else next()
              return
            }
            let completed = false
            const completeWrite = (error) => {
              if (completed) return
              completed = true
              writeCompleted(error)
            }
            pendingWrites++
            const acceptsMore = destination.write(value, completeWrite)
            if (settled) return
            if (!acceptsMore) nextCallback = next
            else next()
          } catch (reason) {
            fail(reason, { origin: 'sink', stage: 'write' })
          }
        }
      })

      destination.on('drain', drain)
      stopWatching = runtime.finished(destination, { cleanup: true }, (error) => {
        if (settled) return
        if (error) {
          fail(error, { origin: 'sink', stage: sourceEnded ? 'close' : 'write' })
        } else if (sourceEnded) {
          succeed()
        } else {
          const reason = Error('Destination completed before the source')
          reason.code = 'EXSTREAM_DESTINATION_CLOSED'
          fail(reason, { origin: 'sink', stage: 'write' })
        }
      })
      if (options.signal !== void 0) {
        if (options.signal.aborted) scheduleMicrotask(abortFromSignal)
        else options.signal.addEventListener('abort', abortFromSignal, { once: true })
      }
      sink.once('abort', fail)
      destination.emit('pipe', this)
      scheduleNextTurn(() => {
        try {
          sink.resume()
        } catch (error) {
          fail(error)
        }
      })
    })

  #pipeWebWritable = async (destination, options) => {
    const writer = destination.getWriter()
    const iterator = this.#createAsyncIterator({ signal: options.signal })
    let rejectAbort
    const abortPromise =
      options.signal === void 0
        ? null
        : new Promise((resolve, reject) => {
            rejectAbort = reject
          })
    const abort = () => {
      annotateError(options.signal.reason, { origin: 'lifecycle', stage: 'abort' })
      rejectAbort(options.signal.reason)
    }
    if (options.signal !== void 0) options.signal.addEventListener('abort', abort, { once: true })
    const wait = (promise) => (abortPromise ? Promise.race([promise, abortPromise]) : promise)
    const waitForSink = async (promise, stage) => {
      try {
        return await wait(promise)
      } catch (error) {
        annotateError(error, { origin: 'sink', stage })
        throw error
      }
    }
    try {
      // Sequential awaits are the Web WritableStream backpressure boundary.
      /* oxlint-disable no-await-in-loop */
      while (true) {
        const item = await wait(iterator.next())
        if (item.done) break
        await waitForSink(writer.ready, 'write')
        await waitForSink(writer.write(item.value), 'write')
      }
      /* oxlint-enable no-await-in-loop */
      if (options.end !== false && !options.preventClose) {
        await waitForSink(writer.close(), 'close')
      }
      return destination
    } catch (error) {
      await iterator.throw(error).catch(() => {})
      if (!options.preventAbort) writer.abort(error).catch(() => {})
      throw error
    } finally {
      if (options.signal !== void 0) options.signal.removeEventListener('abort', abort)
      writer.releaseLock()
    }
  }

  #createAsyncIterator = (options = {}) => {
    if (options === null) options = {}
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw Error('error creating async iterator: options must be an object')
    }
    const signal = options.signal
    if (
      signal !== void 0 &&
      (!signal ||
        typeof signal.aborted !== 'boolean' ||
        typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function')
    ) {
      throw Error('error creating async iterator: signal must be an AbortSignal')
    }

    if (this.ended) {
      let terminalError = this.#state === 'aborted' ? this.#abortReason : null
      return {
        next() {
          if (terminalError) {
            const error = terminalError
            terminalError = null
            return Promise.reject(error)
          }
          return Promise.resolve({ done: true, value: void 0 })
        },
        return(value) {
          terminalError = null
          return Promise.resolve({ done: true, value })
        },
        throw(error) {
          terminalError = null
          return Promise.reject(error)
        },
        [Symbol.asyncIterator]() {
          return this
        },
      }
    }

    let closed = false
    let pending
    let sequence = Promise.resolve()
    let sink
    let terminalError

    const cleanup = () => {
      if (signal !== void 0) signal.removeEventListener('abort', abortFromSignal)
    }
    const finish = (error) => {
      if (closed) return
      closed = true
      cleanup()
      if (pending) {
        const request = pending
        pending = null
        if (error) request.reject(error)
        else request.resolve({ done: true, value: void 0 })
      } else if (error) terminalError = error
    }
    const abortFromSignal = () => sink.abort(signal.reason)

    sink = this.consumeSync((error, value) => {
      if (closed) return
      if (value === _.nil) {
        finish()
        return
      }

      sink.pause()
      const request = pending
      pending = null
      if (error) {
        closed = true
        cleanup()
        request.reject(error)
        sink.destroy()
      } else {
        request.resolve({ done: false, value })
      }
    })
    sink.once('error', finish)

    if (signal !== void 0) {
      if (signal.aborted) scheduleMicrotask(abortFromSignal)
      else signal.addEventListener('abort', abortFromSignal, { once: true })
    }

    const readOne = () => {
      if (closed) {
        if (terminalError) {
          const error = terminalError
          terminalError = null
          return Promise.reject(error)
        }
        return Promise.resolve({ done: true, value: void 0 })
      }
      return new Promise((resolve, reject) => {
        pending = { reject, resolve }
        sink.resume()
      })
    }

    return {
      next() {
        const request = sequence.then(readOne)
        sequence = request.then(noCancel, noCancel)
        return request
      },
      return(value) {
        terminalError = null
        finish()
        sink.destroy()
        return Promise.resolve({ done: true, value })
      },
      throw(error) {
        sink.abort(error)
        terminalError = null
        return Promise.reject(error)
      },
      [Symbol.asyncIterator]() {
        return this
      },
    }
  };

  [Symbol.asyncIterator]() {
    return this.#createAsyncIterator()
  }

  toNodeReadable(options = {}) {
    if (!runtime.readableFromAsyncIterable) {
      throw Error('toNodeReadable() is not available in this runtime')
    }
    if (options === null) options = {}
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw Error('error in .toNodeReadable(). options must be an object')
    }
    return runtime.readableFromAsyncIterable(
      this.#createAsyncIterator({ signal: options.signal }),
      options,
    )
  }

  toWebReadable(options = {}) {
    if (typeof globalThis.ReadableStream !== 'function') {
      throw Error('toWebReadable() requires ReadableStream support')
    }
    if (options === null) options = {}
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw Error('error in .toWebReadable(). options must be an object')
    }
    const iterator = this.#createAsyncIterator({ signal: options.signal })
    return new globalThis.ReadableStream(
      {
        async pull(controller) {
          try {
            const item = await iterator.next()
            if (item.done) controller.close()
            else controller.enqueue(item.value)
          } catch (error) {
            controller.error(error)
          }
        },
        async cancel(reason) {
          if (reason === void 0) await iterator.return()
          else await iterator.throw(reason).catch(() => {})
        },
      },
      options.strategy,
    )
  }

  toArray() {
    return this.#runTerminal({ collect: true })
  }

  drain() {
    return this.#runTerminal({ collect: false })
  }

  single() {
    return new Promise((resolve, reject) => {
      let settled = false
      let hasValue = false
      let result
      let sink

      const cleanup = () => {
        sink.off('error', fail)
        sink.off('abort', fail)
        sink.off('end', succeed)
      }
      const fail = (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const rejectRecord = (error) => {
        if (settled) return
        sink.pause()
        scheduleMicrotask(() => {
          sink.abort(error)
        })
        fail(error)
      }
      const succeed = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      sink = this.consumeSync((error, value, push) => {
        if (error) {
          rejectRecord(error)
        } else if (value === _.nil) {
          push(null, _.nil)
        } else if (hasValue) {
          const error = Error('single() expected at most one value')
          error.code = 'EXSTREAM_MORE_THAN_ONE_VALUE'
          rejectRecord(error)
        } else {
          hasValue = true
          result = value
        }
      })
      sink.once('error', fail).once('abort', fail).once('end', succeed)
      try {
        sink.resume()
      } catch (error) {
        fail(error)
      }
    })
  }

  #runTerminal = ({ collect }) =>
    new Promise((resolve, reject) => {
      let settled = false
      const values = collect ? [] : null
      let sink

      const cleanup = () => {
        sink.off('error', fail)
        sink.off('abort', fail)
        sink.off('end', succeed)
      }
      const fail = (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const rejectRecord = (error) => {
        if (settled) return
        sink.pause()
        scheduleMicrotask(() => {
          if (!sink.ended) sink.abort(error)
        })
        fail(error)
      }
      const succeed = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve(collect ? values : void 0)
      }

      sink = this.consumeSync((error, value, push) => {
        if (error) rejectRecord(error)
        else if (value === _.nil) push(null, _.nil)
        else if (collect) values.push(value)
      })
      sink.once('error', fail).once('abort', fail).once('end', succeed)
      try {
        sink.resume()
      } catch (error) {
        fail(error)
      }
    })

  fork(disableAutostart = false) {
    if (this.#resumedAtLeastOnce)
      throw Error("this stream is already started. you can't fork it anymore")
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
      this.toNodeReadable().pipe(target)
      return new Exstream(target)
    } else if (_.isNodeStream(target) && writable) {
      this.toNodeReadable().pipe(target)
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

    const slots = []
    const ready = []
    let outerEnded = false
    let outerNext = null
    let started = false
    let cleaningUp = false
    let pumping = false
    let outerSink
    let merged

    const currentSlot = () => slots[0]
    const hasReadyFrame = () =>
      preserveOrder ? currentSlot()?.frames.length > 0 : ready.length > 0

    const resumeOuter = () => {
      if (outerEnded || slots.length >= parallelism || !outerNext) return
      const next = outerNext
      outerNext = null
      next()
    }

    const releaseCompletedSlots = () => {
      if (preserveOrder) {
        while (currentSlot()?.ended && currentSlot().frames.length === 0) {
          slots.shift()
        }
      } else {
        for (let index = slots.length - 1; index >= 0; index--) {
          const slot = slots[index]
          if (slot.ended && slot.frames.length === 0) slots.splice(index, 1)
        }
      }
      resumeOuter()
    }

    const completed = () => outerEnded && slots.length === 0

    const queueFrame = (slot, frame, next) => {
      const queued = { frame, next, slot }
      slot.frames.push(queued)
      if (!preserveOrder) ready.push(queued)
    }

    const takeReadyFrame = () => {
      const queued = preserveOrder ? currentSlot().frames.shift() : ready.shift()
      if (!preserveOrder) queued.slot.frames.shift()
      return queued
    }

    const writeRecord = (error, value, context) => {
      if (error) merged._writeError(error, context)
      else if (context === void 0) merged._writeData(value)
      else merged._writeData(value, false, context)
    }

    const writeFrame = (frame) => {
      if (frame.type === ERROR) writeRecord(frame.error, null, frame.context)
      else writeRecord(null, frame.value, frame.context)
    }

    const pump = () => {
      if (pumping || cleaningUp || merged.ended) return
      pumping = true
      try {
        releaseCompletedSlots()
        while (!merged.paused && hasReadyFrame()) {
          const queued = takeReadyFrame()
          writeFrame(queued.frame)
          if (merged.ended) return
          if (queued.next) queued.next()
          releaseCompletedSlots()
        }
        if (completed() && !merged.paused) merged.end()
      } finally {
        pumping = false
      }
    }

    const acceptInnerRecord = (slot, error, value, context, next) => {
      if (preserveOrder && slot !== currentSlot()) {
        const frame = error
          ? errorFrame(error, error.exstreamInput, false, context)
          : dataFrame(value, context)
        queueFrame(slot, frame, null)
        next()
      } else if (!pumping && !merged.paused) {
        if (error) merged._writeError(error, context)
        else if (context === void 0) merged._writeData(value)
        else merged._writeData(value, false, context)
        if (!merged.ended) next()
      } else {
        const frame = error
          ? errorFrame(error, error.exstreamInput, false, context)
          : dataFrame(value, context)
        queueFrame(slot, frame, next)
        pump()
      }
    }

    const fail = (error, input) => {
      if (!merged.ended) merged.fail(error, input)
    }

    const abort = (reason) => {
      if (!cleaningUp && !merged.ended) merged.abort(reason)
    }

    const activateInner = (slot, inner) => {
      try {
        let sink
        sink = inner.consume((error, value, push, next) => {
          if (merged.ended) return
          if (value === _.nil) {
            push(null, _.nil)
            return
          }

          const context = sink._recordContext
          acceptInnerRecord(slot, error, value, context, next)
        })
        slot.sink = sink
        sink.once('fatal', fail)
        sink.once('abort', abort)
        sink.once('end', () => {
          if (merged.ended) return
          slot.ended = true
          pump()
        })
        sink.resume()
      } catch (reason) {
        const error = new ExstreamError(reason, inner, { origin: 'operator', stage: 'merge' })
        slot.ended = true
        queueFrame(slot, errorFrame(error, inner, false, slot.context), null)
        if (slot.sink && !slot.sink.ended) slot.sink.destroy()
        pump()
      }
    }

    const addOuterFrame = (frame, context, next) => {
      const slot = { context, ended: true, frames: [], sink: null }
      slots.push(slot)
      outerNext = next
      queueFrame(slot, frame, null)
      pump()
    }

    merged = new Exstream()
    const startOrDrain = () => {
      if (!started) {
        started = true
        outerSink.resume()
      }
      pump()
    }
    merged.on('drain', startOrDrain)

    outerSink = this.consume((error, value, push, next) => {
      if (merged.ended) return
      const context = outerSink._recordContext
      if (value === _.nil) {
        outerNext = null
        push(null, _.nil)
      } else if (error) {
        addOuterFrame(errorFrame(error, error.exstreamInput, false, context), context, next)
      } else if (!_.isExstream(value)) {
        const invalid = new ExstreamError(
          Error('.merge() can merge ONLY exstream instances'),
          value,
          { origin: 'operator', stage: 'merge' },
        )
        addOuterFrame(errorFrame(invalid, value, false, context), context, next)
      } else {
        const slot = { context, ended: false, frames: [], sink: null }
        slots.push(slot)
        outerNext = next
        activateInner(slot, value)
        resumeOuter()
      }
    })

    outerSink.once('fatal', fail)
    outerSink.once('abort', abort)
    outerSink.once('end', () => {
      if (merged.ended) return
      outerEnded = true
      pump()
    })
    merged.once('abort', (reason) => {
      cleaningUp = true
      if (!outerSink.ended) outerSink.abort(reason)
      for (const slot of slots) {
        if (slot.sink && !slot.sink.ended) slot.sink.abort(reason)
      }
    })
    merged.once('end', () => {
      cleaningUp = true
      outerNext = null
      if (!outerSink.ended) outerSink.destroy()
      for (const slot of slots) {
        if (slot.sink && !slot.sink.ended) slot.sink.destroy()
      }
      slots.length = 0
      ready.length = 0
    })
    return merged
  }
}

module.exports = {
  BufferOverflowError,
  Exstream,
  ExstreamError,
}