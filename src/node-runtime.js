const { EventEmitter } = require('events')
const { finished, Readable } = require('stream')
const { StringDecoder } = require('string_decoder')
const { configureRuntime } = require('./runtime.js')

const concatTextBytes = (chunks, totalLength) => {
  const first = chunks[0]
  if (first) {
    let nextOffset = first.byteOffset
    const contiguous = chunks.every((chunk) => {
      const matches = chunk.buffer === first.buffer && chunk.byteOffset === nextOffset
      nextOffset += chunk.byteLength
      return matches
    })
    if (contiguous) return Buffer.from(first.buffer, first.byteOffset, totalLength)
  }
  return Buffer.concat(chunks, totalLength)
}

const asBytes = (value, encoding) => {
  if (Buffer.isBuffer(value)) return value
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  return Buffer.from(value, encoding)
}

configureRuntime({
  asBytes,
  bytesEqual: (left, right) => left.equals(right),
  bytesFrom: (value, encoding) => Buffer.from(value, encoding),
  byteLength: (value, encoding) => Buffer.byteLength(value, encoding),
  bytesToString: (value, encoding, start, end) => value.toString(encoding, start, end),
  concatBytes: (chunks, totalLength) => Buffer.concat(chunks, totalLength),
  concatTextBytes,
  createBase64Encoder: () => new StringDecoder('base64'),
  EventBase: EventEmitter,
  finished,
  createStringDecoder: (encoding) => new StringDecoder(encoding),
  decodeBase64: (value) => Buffer.from(value, 'base64'),
  indexOfByte: (value, byte, offset) => value.indexOf(byte, offset),
  isNodeStream: (value) =>
    value && typeof value.on === 'function' && typeof value.pipe === 'function',
  isStandardOutput: (value) => value === process.stdout || value === process.stderr,
  readableFromAsyncIterable: (iterable, options) => Readable.from(iterable, options),
  platform: 'node',
})