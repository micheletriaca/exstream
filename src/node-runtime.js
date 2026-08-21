const { EventEmitter } = require('events')
const { Duplex, finished, Readable, Writable } = require('stream')
const { StringDecoder } = require('string_decoder')
const { configureRuntime } = require('./runtime.js')
const { kAbort, kDestroy } = require('./stream-control.js')

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

const duplexFromPipeline = (input, output) => {
  let outputEnded = false
  let pendingWrite = null

  const completePendingWrite = (error) => {
    if (!pendingWrite) return
    const { callback, onDrain, onError } = pendingWrite
    pendingWrite = null
    input.off('drain', onDrain)
    input.off('error', onError)
    callback(error)
  }

  const readable = Readable.from(output, { objectMode: true })
  readable.once('end', () => {
    outputEnded = true
    completePendingWrite()
  })
  readable.once('error', completePendingWrite)

  const writable = new Writable({
    objectMode: true,
    write(value, encoding, callback) {
      if (outputEnded || input.ended) {
        callback()
        return
      }

      let settled = false
      const complete = (error) => {
        if (settled) return
        settled = true
        completePendingWrite(error)
      }
      const onDrain = () => complete()
      const onError = (error) => complete(error)
      pendingWrite = { callback, onDrain, onError }
      input.once('drain', onDrain)
      input.once('error', onError)

      try {
        if (input.write(value)) complete()
      } catch (error) {
        complete(error)
      }
    },
    final(callback) {
      try {
        if (!input.ended) input.end()
        callback()
      } catch (error) {
        callback(error)
      }
    },
    destroy(error, callback) {
      completePendingWrite(error || void 0)
      if (error) input[kAbort](error)
      else input[kDestroy]()
      callback(error)
    },
  })

  return Duplex.from({ readable, writable })
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
  duplexFromPipeline,
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