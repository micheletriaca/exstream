const { Exstream } = require('./exstream.js')
const { dataValue } = require('./protocol.js')
const { kFail } = require('./stream-control.js')

const asEventInterface = (target) => {
  if (
    target &&
    typeof target.addEventListener === 'function' &&
    typeof target.removeEventListener === 'function'
  ) {
    return {
      off: (event, listener) => target.removeEventListener(event, listener),
      on: (event, listener) => target.addEventListener(event, listener),
    }
  }
  if (target && typeof target.on === 'function' && typeof target.off === 'function') {
    return {
      off: (event, listener) => target.off(event, listener),
      on: (event, listener) => target.on(event, listener),
    }
  }
  throw Error('fromEvent() target must be an EventTarget or EventEmitter-like object')
}

const eventValue = (args) => (args.length === 1 ? args[0] : args)

const fromEvent = (target, event, options = null) => {
  if (typeof event !== 'string' && typeof event !== 'symbol') {
    throw Error('fromEvent() event must be a string or symbol')
  }
  if (options === null || options === void 0) options = {}
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw Error('fromEvent() options must be an object')
  }
  const events = asEventInterface(target)
  const canPause = typeof target.pause === 'function' && typeof target.resume === 'function'
  const highWaterMark =
    options.highWaterMark === void 0 ? (canPause ? 1 : 1024) : options.highWaterMark
  let numericHighWaterMark
  try {
    numericHighWaterMark = Number(highWaterMark)
  } catch {
    // Exstream owns the complete buffer validation and error message.
  }
  if (!canPause && numericHighWaterMark === Infinity) {
    throw Error('fromEvent() requires a finite highWaterMark for non-pausable sources')
  }
  const overflow = options.overflow === void 0 ? 'error' : options.overflow
  const source = new Exstream(null, {
    bufferLimit: highWaterMark,
    overflow,
    signal: options.signal,
    start: options.start,
  })
  source.received = 0
  let producerPaused = false
  let subscribed = true

  const map = options.map === void 0 ? (...args) => eventValue(args) : options.map
  if (typeof map !== 'function') throw Error('fromEvent() map must be a function')

  const pauseProducer = () => {
    if (!canPause || producerPaused) return
    producerPaused = true
    target.pause()
  }
  const resumeProducer = () => {
    if (!producerPaused) return
    /* v8 ignore else -- The drain listener is removed before source termination. */
    if (!source.ended) {
      producerPaused = false
      target.resume()
    }
  }
  const onData = (...args) => {
    source.received++
    try {
      const value = map(...args)
      if (!source.write(dataValue(value))) pauseProducer()
    } catch (error) {
      source[kFail](error, args)
    }
  }
  const onEnd = () => source.end()
  const onError = (error) => source[kFail](error?.error || error)
  const endEvent = options.end === void 0 ? 'end' : options.end
  const errorEvent = options.error === void 0 ? 'error' : options.error

  const unsubscribe = () => {
    /* v8 ignore else -- unsubscribe is registered once and lifecycle end is idempotent. */
    if (subscribed) {
      subscribed = false
      events.off(event, onData)
      if (endEvent) events.off(endEvent, onEnd)
      if (errorEvent) events.off(errorEvent, onError)
      source.off('drain', resumeProducer)
    }
  }

  if (source.ended) return source
  events.on(event, onData)
  if (endEvent) events.on(endEvent, onEnd)
  if (errorEvent) events.on(errorEvent, onError)
  source.on('drain', resumeProducer)
  source.once('end', unsubscribe)

  return source
}

module.exports = { fromEvent }