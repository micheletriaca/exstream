const _ = require('./utils')
const { EventHub } = require('./event-hub.js')
const { runtime } = require('./runtime.js')
const { createCooperativeScheduler, scheduleMicrotask, scheduleNextTurn } = require('./scheduler')
const { DATA, END, ERROR, dataFrame, endFrame, errorFrame, isDataValue } = require('./protocol')
const { forkContext } = require('./context')
const { annotateError } = require('./error-info.js')
const { instantiatePipeline } = require('./pipeline-control.js')
const { kAbort, kDestroy, kFail, kPause, kResume } = require('./stream-control.js')

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
  #activationStarted = false
  #startPromise = null
  #abortReason = null
  #failing = false
  #aborting = false
  #abortController = null
  #signalAbortReason = signalActive

  #paused = true
  #pausedFromOutside = true
  #pausedFromInside = false
  #source = null

  #nilPushed = false

  #buffer = []
  #buffered = 0
  #peakBuffered = 0
  #dropped = 0
  #bufferLimit = Infinity
  #overflowPolicy = 'error'
  #sourceIterator = null
  #sourceIteratorAsync = false
  #sourceIteratorDone = false
  #sourceFrames = false
  #sourcePulling = false
  #sourceStage = 'iterate'
  #sourceInitializer = null
  #scheduleSourceContinuation = createCooperativeScheduler()
  #cancelSourceContinuation = noCancel

  #consumeFn = null
  #consumeSyncFn = null
  #activeContext = void 0
  #nextCalled = true
  #consumers = []
  #observers = []
  #observedSource = null
  #contextBoundary = false
  #autostart = true
  #startMode = 'auto'

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

  get paused() {
    return this.#paused
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
    this.#configureStart(options)
    this.#configureAbortSignal(options)
    if (this.ended) return
    if (!xs) {
      return this
    } else if (_.isExstream(xs)) {
      return xs
    } else if (_.isNodeStream(xs)) {
      this.#sourceInitializer = () =>
        _.isAsyncIterable(xs) ? this.#pipeAsyncIterable(xs, 'read') : this.#pipeReadable(xs)
    } else if (runtime.isWebReadableStream(xs)) {
      this.#sourceInitializer = () => this.#pipeWebReadable(xs)
    } else if (_.isIterable(xs)) {
      this.#sourceInitializer = () => {
        this.#setSourceIterator(xs[Symbol.iterator]())
      }
    } else if (_.isAsyncIterable(xs)) {
      this.#sourceInitializer = () => this.#pipeAsyncIterable(xs)
    } else if (_.isPromise(xs)) {
      return new Exstream([xs], options).mapAsync((value) => value)
    } else {
      throw Error(
        'error creating exstream: invalid source. source can be one of: iterable, ' +
          'async iterable, a promise, a Web ReadableStream, or a Node readable stream',
      )
    }
  }

  static fromFrames(iterable, options = null) {
    const stream = new Exstream(null, options)
    stream.#sourceInitializer = () => stream.#pipeAsyncIterable(iterable, 'iterate', true)
    return stream
  }

  static fromDeferred(factory, options = null) {
    const frames = {
      async *[Symbol.asyncIterator]() {
        let source
        try {
          source = await factory()
          if (
            !(
              _.isExstream(source) ||
              _.isNodeStream(source) ||
              runtime.isWebReadableStream(source) ||
              _.isIterable(source) ||
              _.isAsyncIterable(source)
            )
          ) {
            throw Error('defer() factory must return a valid stream source')
          }
        } catch (error) {
          yield errorFrame(new ExstreamError(error, void 0, { origin: 'source', stage: 'defer' }))
          return
        }

        let stream
        try {
          stream = new Exstream(source)
        } catch {
          yield errorFrame(
            new ExstreamError(Error('defer() factory must return a valid stream source'), void 0, {
              origin: 'source',
              stage: 'defer',
            }),
          )
          return
        }

        const iterator = stream.#createAsyncIterator({ frames: true })
        try {
          /* oxlint-disable no-await-in-loop -- Frame order and backpressure are sequential. */
          while (true) {
            const item = await iterator.next()
            if (item.done) return
            yield item.value
          }
          /* oxlint-enable no-await-in-loop */
        } finally {
          await iterator.return()
        }
      },
    }
    return Exstream.fromFrames(frames, options)
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

  #configureStart = (options) => {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return
    const mode = options.start === void 0 ? 'auto' : options.start
    if (mode !== 'auto' && mode !== 'manual') {
      throw Error('start must be one of: auto, manual')
    }
    this.#startMode = mode
    this.#autostart = mode === 'auto'
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
    const abortFromSignal = () => this[kAbort](signal.reason)
    if (signal.aborted) abortFromSignal()
    else {
      signal.addEventListener('abort', abortFromSignal, { once: true })
      this.#destroyers.push(() => signal.removeEventListener('abort', abortFromSignal))
    }
  }

  #setSourceIterator = (iterator, async = false, stage = 'iterate', frames = false) => {
    this.#sourceIterator = iterator
    this.#sourceIteratorAsync = async
    this.#sourceIteratorDone = false
    this.#sourceFrames = frames
    this.#sourceStage = stage
  }

  #pipeAsyncIterable = (iterable, stage = 'iterate', frames = false) => {
    this.#setSourceIterator(iterable[Symbol.asyncIterator](), true, stage, frames)
  }

  #pipeReadable = (readable) => {
    this.#addOnceListener('error', readable, (reason) => {
      this.write(new ExstreamError(reason, void 0, { origin: 'source', stage: 'read' }))
      scheduleNextTurn(() => this.end())
    })
    this.once('end', () => readable.destroy())
    readable.pipe(this)
  }

  #pipeWebReadable = (readable) => {
    const reader = readable.getReader()
    let released = false
    const release = () => {
      if (released) return
      released = true
      reader.releaseLock()
    }
    this.#setSourceIterator(
      {
        async next() {
          const item = await reader.read()
          if (item.done) release()
          return item
        },
        async return(reason) {
          try {
            await reader.cancel(reason)
          } finally {
            release()
          }
          return { done: true, value: void 0 }
        },
      },
      true,
      'read',
    )
  }

  #addOnceListener = (event, target, handler) => {
    target.once(event, handler)
    this.#destroyers.push(() => target.off(event, handler))
  }

  write(x) {
    if (this.#nilPushed) throw Error('Cannot write to stream after nil')
    return this._write(x)
  }

  #enqueue = (type, value, input, fatal, context, afterWrite) => {
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
    if (afterWrite) frame.afterWrite = afterWrite
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

  _writeData(value, skipBackPressure = false, context, afterWrite) {
    const queued = this.paused && !skipBackPressure
    if (queued) {
      this.#enqueue(DATA, value, void 0, false, context, afterWrite)
    } else if (this.#consumeSyncFn) {
      if (context === void 0) this.#consumeSyncFn(void 0, value, this.#push)
      else this.#consumeSyncContext(void 0, value, context)
    } else if (this.#consumeFn) {
      this.#consumeAsyncRecord(void 0, value, context)
    } else {
      this.#sendData(value, context)
    }

    if (!queued && afterWrite) afterWrite()

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

  #writeControlRecord = (
    type,
    value,
    input,
    fatal,
    context,
    skipBackPressure = false,
    afterWrite,
  ) => {
    if (type === END) this.#nilPushed = true
    const err = type === ERROR ? value : void 0
    const x = type === END ? _.nil : null

    const queued = this.paused && !skipBackPressure
    if (queued) {
      this.#enqueue(type, value, input, fatal, context, afterWrite)
    } else if (this.#consumeSyncFn) {
      if (context === void 0) this.#consumeSyncFn(err, x, this.#push)
      else this.#consumeSyncContext(err, x, context)
    } else if (this.#consumeFn) {
      this.#consumeAsyncRecord(err, x, context)
    } else {
      this.#sendControl(type, value, input, fatal, context)
    }

    if (!queued && afterWrite) afterWrite()

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
      if (this.paused && !syncNext) scheduleMicrotask(() => this[kResume](true))
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
    if (!this.#nextCalled) this[kPause](true)
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
      this[kAbort](error)
    }
  }

  #writeObservedControl = (type, value, input, fatal, context) => {
    if (this.ended || this.#state === 'ending') return
    try {
      this.#writeControlRecord(type, value, input, fatal, context)
    } catch (error) {
      this[kAbort](error)
    }
  }

  start() {
    const root = this.#rootSource()
    if (root !== this) return root.start()
    if (this.ended || this.#state === 'ending') return Promise.resolve()
    if (this.#startPromise) return this.#startPromise
    this.#activationStarted = true
    // A next turn lets downstream adapters finish attaching before activation.
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
    const source = this.#source
    if (source) {
      source.#removeConsumer(this)
      if (propagateUpstream && source.#consumers.length === 0) {
        if (terminalState === 'aborted') source[kAbort](this.#abortReason)
        else source[kDestroy]()
      }
    }
    if (this.#observedSource) this.#observedSource.#removeObserver(this)
    this.#sourceInitializer = null
    this.#cancelSourceContinuation()
    this.#cancelSourceContinuation = noCancel
    this.#closeSourceIterator()
    this.removeAllListeners()
    this.#destroyers.forEach((x) => x())
    this.#destroyers = []
    for (const observer of this.#observers) observer.#observedSource = null
    this.#observers = []
  }

  end() {
    this.#terminate('ended')
  }

  [kDestroy]() {
    return this.ended ? void 0 : this.#destroyActive()
  }

  #destroyActive = () => {
    const reason = Error('The stream was destroyed')
    reason.name = 'AbortError'
    annotateError(reason, { origin: 'lifecycle', stage: 'destroy' })
    this.#cancelSignal(reason)
    this.#terminate('destroyed', true)
  };

  [kAbort](reason) {
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
  };

  [kFail](reason, input) {
    const error = new ExstreamError(reason, input, { origin: 'operator', stage: 'fail' })
    error.exstreamFatal = true
    let root = this
    while (root.#source) root = root.#source
    return root.#failDownstream(error, input)
  }

  #failDownstream = (error, input) =>
    this.ended ? void 0 : this.#failUnlessInProgress(error, input)

  #failUnlessInProgress = (error, input) =>
    this.#failing ? void 0 : this.#propagateFailure(error, input)

  #emitErrorIfHandled = (error) => (this.listenerCount('error') ? this.emit('error', error) : false)

  #propagateFailure = (error, input) => {
    this.#failing = true
    this[kPause](true)
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
          ? this._writeData(frame.value, force, frame.context, frame.afterWrite)
          : this.#writeControlRecord(
              frame.type,
              frame.error,
              frame.input,
              frame.fatal,
              frame.context,
              force,
              frame.afterWrite,
            )
      if (!wrote) break
    }
    const removed = this.#buffer.slice(0, i + 1)
    this.#buffer = this.#buffer.slice(i + 1)
    this.#buffered -= removed.filter((frame) => frame.type !== END).length
  }

  #closeSourceIterator = () => {
    const iterator = this.#sourceIterator
    const done = this.#sourceIteratorDone
    this.#sourceIterator = null
    this.#sourceIteratorDone = true
    this.#sourcePulling = false
    if (!done && iterator && typeof iterator.return === 'function') {
      const reason =
        this.#signalAbortReason === signalActive ? this.#abortReason : this.#signalAbortReason
      Promise.resolve(iterator.return(reason)).catch(() => {})
    }
  }

  #writeSourceFrame = (frame) => {
    let wrote
    if (frame.type === DATA)
      wrote = this._writeData(frame.value, false, frame.context, frame.afterWrite)
    if (frame.type === ERROR) {
      wrote = frame.fatal
        ? this[kFail](frame.error, frame.input)
        : this.#writeControlRecord(
            ERROR,
            frame.error,
            frame.input,
            false,
            frame.context,
            false,
            frame.afterWrite,
          )
    }
    if (frame.type === END) {
      this.end()
      wrote = false
    }
    return wrote
  }

  #writeSourceValue = (value) =>
    this.#sourceFrames ? this.#writeSourceFrame(value) : this.write(value)

  #failSource = (error) => {
    if (error && error.exstreamFatal) {
      this[kFail](error, error.exstreamInput)
      return
    }
    this.write(new ExstreamError(error, void 0, { origin: 'source', stage: this.#sourceStage }))
    this.end()
  }

  #consumeSyncSource = () => {
    let nextVal
    do {
      try {
        nextVal = this.#sourceIterator.next()
      } catch (e) {
        this.#failSource(e)
        return
      }
      if (!nextVal.done) this.#writeSourceValue(nextVal.value)
      else {
        this.#sourceIteratorDone = true
        this.end()
      }
    } while (!this.#nilPushed && !this.paused)
  }

  #consumeAsyncSource = () => {
    if (this.#sourcePulling) return
    this.#sourcePulling = true
    this[kPause](true)

    let request
    try {
      request = this.#sourceIterator.next()
    } catch (error) {
      this.#sourcePulling = false
      this.#failSource(error)
      return
    }

    Promise.resolve(request).then(
      (item) => {
        this.#sourcePulling = false
        if (this.ended || this.#state === 'ending') return
        if (item.done) {
          this.#sourceIteratorDone = true
          this.end()
          return
        }
        try {
          this.#writeSourceValue(item.value)
        } catch (error) {
          this[kAbort](error)
          return
        }
        if (this.ended || this.#state === 'ending') return
        this.#cancelSourceContinuation = this.#scheduleSourceContinuation(() => {
          this.#cancelSourceContinuation = noCancel
          this[kResume](true)
        })
        return void 0
      },
      (error) => {
        this.#sourcePulling = false
        if (!this.ended && this.#state !== 'ending') this.#failSource(error)
        return void 0
      },
    )
  }

  #rootSource = () => {
    let root = this
    while (root.#source) root = root.#source
    return root
  };

  [kPause](fromInside = false) {
    this.#paused = true
    if (fromInside) this.#pausedFromInside = true
    else this.#pausedFromOutside = true
    if (this.#source) this.#source[kPause]()
  }

  [kResume](fromInside = false) {
    if (fromInside) this.#pausedFromInside = false
    else this.#pausedFromOutside = false
    if (this.#pausedFromInside || this.#pausedFromOutside) return
    if (!this.#autostart || !this.#nextCalled || !this.paused) return
    if (this.ended || this.#state === 'ending') return

    this.#activationStarted = true
    this.#state = 'running'
    this.#paused = false
    if (this.#sourceInitializer) {
      const initialize = this.#sourceInitializer
      this.#sourceInitializer = null
      try {
        initialize()
      } catch (error) {
        this.write(new ExstreamError(error, void 0, { origin: 'source', stage: 'acquire' }))
        this.end()
        return
      }
      if (this.ended || this.#state === 'ending') return
    }
    this.#flushBuffer() // This can pause the stream again if the consumers are slow
    if (this.paused) return

    if (this.#sourceIterator) {
      if (this.#sourceIteratorAsync) this.#consumeAsyncSource()
      else this.#consumeSyncSource()
    }

    if (this.paused) return
    if (!this.#source) this.emit('drain')
    else this.#source.#checkBackPressure()
  }

  #checkBackPressure = () => {
    if (!this.#consumers.length) return this[kPause]()
    for (let i = 0, len = this.#consumers.length; i < len; i++) {
      if (this.#consumers[i].paused) return this[kPause]()
    }
    this[kResume]()
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
    if (!skipCheck && this.#consumers.length) {
      throw Error(
        'This stream has already been transformed or consumed. Please ' +
          'fork() or observe() the stream if you want to perform ' +
          'parallel transformations.',
      )
    }
    s.#source = this
    this.#consumers.push(s)
    this.#checkBackPressure()
  }

  #removeConsumer = (s) => {
    this.#consumers = this.#consumers.filter((c) => c !== s)
    s.#source = null
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
    if (_.isExstreamDestination(destination)) {
      return this.#pipeExstreamDestination(destination, options)
    }
    if (runtime.isWebWritableStream(destination)) {
      return this.#pipeWebWritable(destination, options).then(() => undefined)
    }
    if (!destination || typeof destination.write !== 'function' || !runtime.finished) {
      return Promise.reject(
        Error(
          'error in .pipeTo(). destination must be an Exstream Destination, ' +
            'Node writable, or WritableStream',
        ),
      )
    }
    return this.#pipeNodeWritable(destination, options)
  }

  #pipeExstreamDestination = (destination, options) => {
    const externalSignal = options.signal
    const transferController = new AbortController()
    const sourceSignal = this.signal
    let externallyAborted = false
    let externalAbortReason

    const abortTransfer = (signal) => {
      if (!transferController.signal.aborted) transferController.abort(signal.reason)
    }
    const abortFromSource = () => abortTransfer(sourceSignal)
    const abortFromExternal = () => {
      annotateError(externalSignal.reason, { origin: 'lifecycle', stage: 'abort' })
      externallyAborted = true
      externalAbortReason = externalSignal.reason
      abortTransfer(externalSignal)
      this[kAbort](externalSignal.reason)
    }
    const cleanup = () => {
      sourceSignal.removeEventListener('abort', abortFromSource)
      if (externalSignal !== void 0) {
        externalSignal.removeEventListener('abort', abortFromExternal)
      }
    }
    const fail = (error) => {
      annotateError(error, { origin: 'sink', stage: 'destination' })
      if (!transferController.signal.aborted) transferController.abort(error)
      this[kAbort](error)
      throw error
    }

    sourceSignal.addEventListener('abort', abortFromSource, { once: true })

    if (externalSignal !== void 0) {
      if (externalSignal.aborted) abortFromExternal()
      else externalSignal.addEventListener('abort', abortFromExternal, { once: true })
    }

    let result
    if (externalSignal && externalSignal.aborted) {
      result = Promise.reject(externalSignal.reason)
    } else {
      try {
        result = destination._run(this, { signal: transferController.signal })
        if (!result || typeof result.then !== 'function') {
          const error = Error('error running destination: run must return a promise')
          error.code = 'EXSTREAM_DESTINATION_NO_PROMISE'
          result = Promise.reject(error)
        }
      } catch (error) {
        result = Promise.reject(error)
      }
    }

    const completion = Promise.resolve(result).then(
      () => {
        if (externallyAborted) throw externalAbortReason
        if (this.state === 'aborted') throw this.abortReason
        if (this.ended) return undefined
        const error = Error('Destination completed before consuming its source')
        error.code = 'EXSTREAM_DESTINATION_INCOMPLETE'
        throw error
      },
      (error) => {
        throw externallyAborted ? externalAbortReason : error
      },
    )

    return completion.catch(fail).finally(cleanup)
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
        sink[kAbort](error)
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
          sink[kResume]()
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
    const frames = options.frames === true
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
    const abortFromSignal = () => sink[kAbort](signal.reason)

    sink = this.consumeSync((error, value) => {
      if (closed) return
      if (value === _.nil) {
        finish()
        return
      }

      sink[kPause]()
      const request = pending
      pending = null
      if (error && !frames) {
        closed = true
        cleanup()
        request.reject(error)
        sink[kDestroy]()
      } else {
        request.resolve({
          done: false,
          value: error
            ? errorFrame(
                error,
                error.exstreamInput,
                error.exstreamFatal === true,
                sink._recordContext,
              )
            : frames
              ? dataFrame(value, sink._recordContext)
              : value,
        })
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
        sink[kResume]()
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
        sink[kDestroy]()
        return Promise.resolve({ done: true, value })
      },
      throw(error) {
        sink[kAbort](error)
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
        sink[kPause]()
        scheduleMicrotask(() => {
          sink[kAbort](error)
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
        sink[kResume]()
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
        sink[kPause]()
        scheduleMicrotask(() => {
          if (!sink.ended) sink[kAbort](error)
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
        sink[kResume]()
      } catch (error) {
        fail(error)
      }
    })

  fork() {
    if (arguments.length) {
      throw Error("fork() does not accept arguments; use { start: 'manual' } on the source")
    }
    const root = this.#rootSource()
    if (root.#activationStarted || root.ended)
      throw Error("this stream is already started. you can't fork it anymore")
    root.#autostart = false
    if (root.#startMode === 'auto') scheduleMicrotask(() => root.start())
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
      const findParent = (x) => (x.#source ? findParent(x.#source) : x)
      this.#addConsumer(findParent(target))
      return target
    } else if (_.isExstreamPipeline(target)) {
      const pipelineInstance = instantiatePipeline(target)
      this.#addConsumer(pipelineInstance.input)
      return pipelineInstance.output
    } else if (_.isNodeStream(target) && !writable) {
      this.toNodeReadable().pipe(target)
      return new Exstream(target)
    } else if (_.isNodeStream(target) && writable) {
      this.toNodeReadable().pipe(target)
      const s = new Exstream()
      s.readable = false
      s.#source = this
      s[kResume]()
      s.#addOnceListener('error', target, (e) => {
        s.write(e)
        scheduleNextTurn(() => s.end())
      })
      s.#addOnceListener('finish', target, () => {
        s.emit('finish')
        scheduleNextTurn(() => s[kDestroy]())
      })
      s.#addOnceListener('close', target, () => {
        s.emit('close')
        scheduleNextTurn(() => s[kDestroy]())
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

  merge(options = null) {
    if (options === null || options === void 0) options = {}
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw Error('error in .merge(). options must be an object')
    }
    let { concurrency = Infinity, ordered = false } = options
    concurrency = _.asPositiveInteger(concurrency, true)
    if (concurrency === null) {
      throw Error('error in .merge(). concurrency must be a positive integer or Infinity')
    }
    if (typeof ordered !== 'boolean') {
      throw Error('error in .merge(). ordered must be a boolean')
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
    const hasReadyFrame = () => (ordered ? currentSlot()?.frames.length > 0 : ready.length > 0)

    const resumeOuter = () => {
      if (outerEnded || slots.length >= concurrency || !outerNext) return
      const next = outerNext
      outerNext = null
      next()
    }

    const releaseCompletedSlots = () => {
      if (ordered) {
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
      if (!ordered) ready.push(queued)
    }

    const takeReadyFrame = () => {
      const queued = ordered ? currentSlot().frames.shift() : ready.shift()
      if (!ordered) queued.slot.frames.shift()
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
      if (ordered && slot !== currentSlot()) {
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
      if (!merged.ended) merged[kFail](error, input)
    }

    const abort = (reason) => {
      if (!cleaningUp && !merged.ended) merged[kAbort](reason)
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
        sink[kResume]()
      } catch (reason) {
        const error = new ExstreamError(reason, inner, { origin: 'operator', stage: 'merge' })
        slot.ended = true
        queueFrame(slot, errorFrame(error, inner, false, slot.context), null)
        if (slot.sink && !slot.sink.ended) slot.sink[kDestroy]()
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

    const addOuterError = (reason, input, context, next) => {
      const error = new ExstreamError(reason, input, { origin: 'operator', stage: 'merge' })
      addOuterFrame(errorFrame(error, input, false, context), context, next)
    }

    const activateOuterValue = (value, context, next) => {
      const inner = value
      if (!_.isExstream(inner)) {
        addOuterError(Error('.merge() can merge ONLY exstream instances'), value, context, next)
        return
      }

      const slot = { context, ended: false, frames: [], sink: null }
      slots.push(slot)
      outerNext = next
      activateInner(slot, inner)
      resumeOuter()
    }

    merged = new Exstream()
    const startOrDrain = () => {
      if (!started) {
        started = true
        outerSink[kResume]()
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
      } else {
        activateOuterValue(value, context, next)
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
      if (!outerSink.ended) outerSink[kAbort](reason)
      for (const slot of slots) {
        if (slot.sink && !slot.sink.ended) slot.sink[kAbort](reason)
      }
    })
    merged.once('end', () => {
      cleaningUp = true
      outerNext = null
      if (!outerSink.ended) outerSink[kDestroy]()
      for (const slot of slots) {
        if (slot.sink && !slot.sink.ended) slot.sink[kDestroy]()
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