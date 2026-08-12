const normalizeEncoding = (encoding = 'utf8') =>
  encoding.toLowerCase().replaceAll('_', '-').replace('utf8', 'utf-8')

class TextBytes extends Uint8Array {
  equals(other) {
    return bytesEqual(this, other)
  }

  toString(encoding = 'utf8', start = 0, end = this.length) {
    return decodeBytes(this, encoding, start, end)
  }
}

const asUint8Array = (value, encoding = 'utf8') => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (typeof value === 'string') {
    if (normalizeEncoding(encoding) !== 'utf-8') {
      throw Error(`encoding ${encoding} is not supported in this runtime`)
    }
    return new TextEncoder().encode(value)
  }
  return Uint8Array.from(value)
}

const concatBytes = (chunks, totalLength) => {
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

const concatTextBytes = (chunks, totalLength) => {
  const result = new TextBytes(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

const bytesEqual = (left, right) => {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}

const indexOfByte = (bytes, byte, offset = 0) => {
  for (let index = offset; index < bytes.length; index++) {
    if (bytes[index] === byte) return index
  }
  return -1
}

const decodeBytes = (bytes, encoding = 'utf8', start = 0, end = bytes.length) =>
  new TextDecoder(normalizeEncoding(encoding)).decode(bytes.subarray(start, end))

const createStringDecoder = (encoding = 'utf8') => {
  const decoder = new TextDecoder(normalizeEncoding(encoding))
  return {
    write: (value) => decoder.decode(asUint8Array(value), { stream: true }),
    end: () => decoder.decode(),
  }
}

const createBase64Encoder = () => {
  let pending = new Uint8Array(0)
  const encode = (bytes) => {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
  return {
    write(value) {
      const bytes = asUint8Array(value)
      const input = concatBytes([pending, bytes], pending.length + bytes.length)
      const length = input.length - (input.length % 3)
      pending = input.slice(length)
      return length ? encode(input.subarray(0, length)) : ''
    },
    end() {
      const result = pending.length ? encode(pending) : ''
      pending = new Uint8Array(0)
      return result
    },
  }
}

const decodeBase64 = (value) => {
  const binary = atob(value)
  const result = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) result[index] = binary.charCodeAt(index)
  return result
}

module.exports = {
  asUint8Array,
  bytesEqual,
  concatBytes,
  concatTextBytes,
  createBase64Encoder,
  createStringDecoder,
  decodeBase64,
  decodeBytes,
  indexOfByte,
}