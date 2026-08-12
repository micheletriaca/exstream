const webCodecs = require('./web-codecs.js')

const unsupported = (operation) => () => {
  throw Error(`${operation} is not available in this runtime`)
}

const runtime = {
  bytesEqual: webCodecs.bytesEqual,
  bytesFrom: webCodecs.asUint8Array,
  bytesToString: webCodecs.decodeBytes,
  concatBytes: webCodecs.concatBytes,
  concatTextBytes: webCodecs.concatTextBytes,
  createBase64Encoder: webCodecs.createBase64Encoder,
  EventBase: class {},
  createNodeTransform: unsupported('toNodeStream()'),
  finished: null,
  isNodeStream: () => false,
  isWebReadableStream: (value) =>
    value && typeof value.getReader === 'function' && typeof value.tee === 'function',
  isWebWritableStream: (value) =>
    value && typeof value.getWriter === 'function' && typeof value.abort === 'function',
  isStandardOutput: () => false,
  indexOfByte: webCodecs.indexOfByte,
  decodeBase64: webCodecs.decodeBase64,
  createStringDecoder: webCodecs.createStringDecoder,
  readableFromAsyncIterable: null,
  platform: null,
}

const configureRuntime = (adapter) => Object.assign(runtime, adapter)

module.exports = { configureRuntime, runtime }