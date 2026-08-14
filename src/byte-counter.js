const { runtime } = require('./runtime.js')

const utf8Bytes = (character) => {
  const code = character.charCodeAt(0)
  return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3
}

const createUtf8ByteCounter = (limit, exceeded) => {
  limit = limit === void 0 ? Infinity : limit
  let bytes = 0
  let pendingHighSurrogate = false

  const addBytes = (count) => {
    bytes += count
    if (bytes > limit && exceeded) {
      exceeded(bytes)
    } else {
      return bytes
    }
    return bytes
  }

  const addCharacter = (character) => {
    const code = character.charCodeAt(0)
    if (pendingHighSurrogate) {
      pendingHighSurrogate = false
      if (code >= 0xdc00 && code <= 0xdfff) {
        addBytes(4)
        return bytes
      }
      addBytes(3)
    }
    if (code >= 0xd800 && code <= 0xdbff) pendingHighSurrogate = true
    else addBytes(utf8Bytes(character))
    return bytes
  }

  const add = (text) => {
    for (let index = 0; index < text.length; index++) addCharacter(text[index])
    return bytes
  }

  const finish = () => {
    if (pendingHighSurrogate) {
      pendingHighSurrogate = false
      addBytes(3)
    }
    return bytes
  }

  const reset = () => {
    bytes = 0
    pendingHighSurrogate = false
  }

  return { add, addCharacter, finish, reset }
}

const createEncodedByteCounter = (encoding, limit, exceeded) => {
  limit = limit === void 0 ? Infinity : limit
  exceeded = exceeded || ((bytes) => bytes)
  const normalized = encoding.toLowerCase().replaceAll('_', '-').replace('utf8', 'utf-8')
  if (normalized === 'utf-8') {
    return createUtf8ByteCounter(limit, exceeded)
  }
  let bytes = 0
  return {
    add(text) {
      bytes += runtime.byteLength(text, encoding)
      if (bytes > limit) {
        exceeded(bytes)
      } else {
        return bytes
      }
      return bytes
    },
    finish: () => bytes,
    reset() {
      bytes = 0
    },
  }
}

module.exports = { createEncodedByteCounter, createUtf8ByteCounter }