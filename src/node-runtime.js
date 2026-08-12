const { EventEmitter } = require('events')
const { finished, Readable, Transform } = require('stream')
const { StringDecoder } = require('string_decoder')
const { configureRuntime } = require('./runtime.js')

configureRuntime({
  bytesEqual: (left, right) => left.equals(right),
  bytesFrom: (value, encoding) => Buffer.from(value, encoding),
  bytesToString: (value, encoding, start, end) => value.toString(encoding, start, end),
  concatBytes: (chunks, totalLength) => Buffer.concat(chunks, totalLength),
  concatTextBytes: (chunks, totalLength) => Buffer.concat(chunks, totalLength),
  createBase64Encoder: () => new StringDecoder('base64'),
  EventBase: EventEmitter,
  createNodeTransform: (options) =>
    new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        this.push(chunk)
        callback()
      },
      ...options,
    }),
  finished,
  createStringDecoder: (encoding) => new StringDecoder(encoding),
  decodeBase64: (value) => Buffer.from(value, 'base64'),
  indexOfByte: (value, byte, offset) => value.indexOf(byte, offset),
  isNodeStream: (value) =>
    value && typeof value.on === 'function' && typeof value.pipe === 'function',
  isStandardOutput: (value) => value === process.stdout || value === process.stderr,
  readableFromAsyncIterable: (iterable) => Readable.from(iterable),
  platform: 'node',
})