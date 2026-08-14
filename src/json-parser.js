const { parseJsonPath, pathMatches } = require('./json-path.js')
const { createUtf8ByteCounter } = require('./byte-counter.js')

class JsonParseError extends Error {
  constructor(message, { code = 'EXSTREAM_JSON_PARSE', column, line, offset, record } = {}) {
    super(`${message} at line ${line}, column ${column}`)
    this.name = 'JsonParseError'
    this.code = code
    this.column = column
    this.line = line
    this.offset = offset
    if (record !== void 0) this.record = record
  }
}

const asLimit = (value, name) => {
  if (value === void 0 || value === Infinity) return Infinity
  let number
  try {
    number = Number(value)
  } catch {
    number = Number.NaN
  }
  if (!Number.isInteger(number) || number <= 0) {
    throw Error(`${name} must be a positive integer or Infinity`)
  }
  return number
}

const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const numberCharacter = /[\dE+.e-]/
const whitespace = /[\t\n\r ]/
const literals = { f: ['false', false], n: ['null', null], t: ['true', true] }

const createJsonParser = ({
  baseLine = 1,
  baseOffset = 0,
  maxDepth = Infinity,
  maxValueBytes = Infinity,
  onValue,
  path = '$',
  record,
}) => {
  const selectedPath = Array.isArray(path) ? path : parseJsonPath(path)
  const stack = []
  let rootPhase = 'value'
  let token = null
  let line = baseLine
  let column = 1
  let offset = baseOffset
  let previousCarriage = false
  let ended = false
  let valueCounter = null

  const location = (code) => ({ code, column, line, offset, record })
  const parseError = (message, code) => new JsonParseError(message, location(code))
  const currentFrame = () => stack[stack.length - 1]

  const advance = (character) => {
    if (valueCounter) valueCounter.addCharacter(character)
    offset++
    if (character === '\r') {
      line++
      column = 1
      previousCarriage = true
    } else if (character === '\n') {
      line += previousCarriage ? 0 : 1
      column = 1
      previousCarriage = false
    } else {
      column++
      previousCarriage = false
    }
  }

  const define = (target, key, value) => {
    if (key === '__proto__') {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      })
    } else target[key] = value
  }

  const valuePath = () => {
    const parent = currentFrame()
    if (!parent) {
      return []
    } else if (parent.kind === 'array') {
      return [...parent.path, parent.index]
    } else {
      return [...parent.path, parent.key]
    }
  }

  const shouldCapture = (pathToValue) => {
    const parent = currentFrame()
    return Boolean(parent?.capture) || pathMatches(pathToValue, selectedPath)
  }

  const beginValueCount = () => {
    if (maxValueBytes === Infinity) return
    valueCounter = createUtf8ByteCounter(maxValueBytes, () => {
      throw parseError(
        `JSON value exceeds maxValueBytes (${maxValueBytes})`,
        'EXSTREAM_JSON_MAX_VALUE_BYTES',
      )
    })
  }

  const finishValue = (value, pathToValue, capture, start) => {
    if (pathMatches(pathToValue, selectedPath)) {
      if (valueCounter) valueCounter.finish()
      valueCounter = null
      onValue(value, start)
    } else if (!capture) {
      value = void 0
    }
    const parent = currentFrame()
    if (!parent) {
      rootPhase = 'done'
      return
    } else if (parent.kind === 'array') {
      if (parent.capture) parent.value.push(value)
      parent.index++
    } else {
      if (parent.capture) define(parent.value, parent.key, value)
      parent.key = null
    }
    parent.phase = 'commaOrEnd'
  }

  const finishString = () => {
    let value
    if (token.collect) {
      value = JSON.parse(token.raw)
    } else {
      value = void 0
    }
    if (token.role === 'key') {
      const frame = currentFrame()
      frame.key = value
      frame.phase = 'colon'
    } else {
      finishValue(value, token.path, token.capture, token.start)
    }
    token = null
  }

  const finishNumber = () => {
    if (!numberPattern.test(token.raw)) throw parseError('Invalid JSON number')
    const value = Number(token.raw)
    finishValue(value, token.path, token.capture, token.start)
    token = null
  }

  const startString = (role, pathToValue, capture) => {
    token = {
      capture,
      collect: role === 'key' || capture,
      escaped: false,
      path: pathToValue,
      raw: role === 'key' || capture ? '"' : '',
      role,
      start: location(),
      unicode: 0,
      unicodeValue: 0,
      pendingHighSurrogate: false,
    }
    advance('"')
  }

  const startValue = (character) => {
    const pathToValue = valuePath()
    const capture = shouldCapture(pathToValue)
    const start = location()
    if (pathMatches(pathToValue, selectedPath)) beginValueCount()
    if (character === '{' || character === '[') {
      if (stack.length + 1 > maxDepth) {
        throw parseError(`JSON exceeds maxDepth (${maxDepth})`, 'EXSTREAM_JSON_MAX_DEPTH')
      } else {
        stack.push({
          capture,
          index: 0,
          key: null,
          kind: character === '{' ? 'object' : 'array',
          path: pathToValue,
          phase: character === '{' ? 'keyOrEnd' : 'valueOrEnd',
          start,
          value: capture ? (character === '{' ? {} : []) : void 0,
        })
        advance(character)
      }
      return
    } else if (character === '"') {
      startString('value', pathToValue, capture)
      return
    } else if (character === '-' || /\d/.test(character)) {
      token = { capture, path: pathToValue, raw: character, start, type: 'number' }
      advance(character)
      return
    }
    if (character in literals) {
      const [expected, value] = literals[character]
      token = {
        capture,
        expected,
        index: 1,
        path: pathToValue,
        start,
        type: 'literal',
        value,
      }
      advance(character)
      return
    } else {
      throw parseError('Expected a JSON value')
    }
  }

  const acceptCodeUnit = (activeToken, code) => {
    const high = code >= 0xd800 && code <= 0xdbff
    const low = code >= 0xdc00 && code <= 0xdfff
    if (activeToken.pendingHighSurrogate) {
      if (!low) throw parseError('Unpaired high surrogate in JSON string')
      activeToken.pendingHighSurrogate = false
    } else if (high) activeToken.pendingHighSurrogate = true
    else if (low) throw parseError('Unpaired low surrogate in JSON string')
  }

  const processToken = (character) => {
    if (token.type === 'number') {
      if (!numberCharacter.test(character)) {
        finishNumber()
        return false
      } else {
        token.raw += character
        advance(character)
        return true
      }
    } else if (token.type === 'literal') {
      if (character !== token.expected[token.index]) {
        throw parseError('Invalid JSON literal')
      }
      token.index++
      advance(character)
      if (token.index < token.expected.length) {
        return true
      } else {
        const completed = token
        token = null
        finishValue(completed.value, completed.path, completed.capture, completed.start)
        return true
      }
    }
    token.raw = token.collect ? token.raw + character : ''

    if (token.unicode > 0) {
      if (!/[\dA-Fa-f]/.test(character)) {
        throw parseError('Invalid Unicode escape in JSON string')
      } else {
        token.unicodeValue = token.unicodeValue * 16 + Number.parseInt(character, 16)
        token.unicode--
        advance(character)
        if (token.unicode === 0) acceptCodeUnit(token, token.unicodeValue)
        return true
      }
    } else if (token.escaped) {
      if (!/["/\\bfnrtu]/.test(character)) {
        throw parseError('Invalid escape in JSON string')
      } else {
        token.escaped = false
        if (character === 'u') {
          token.unicode = 4
          token.unicodeValue = 0
        } else acceptCodeUnit(token, character.charCodeAt(0))
        advance(character)
        return true
      }
    } else if (character === '"') {
      if (token.pendingHighSurrogate) {
        throw parseError('Unpaired high surrogate in JSON string')
      }
      advance(character)
      finishString()
      return true
    } else if (character === '\\') {
      token.escaped = true
      advance(character)
      return true
    } else if (character.charCodeAt(0) < 0x20) {
      throw parseError('Control character in JSON string')
    } else {
      acceptCodeUnit(token, character.charCodeAt(0))
      advance(character)
      return true
    }
  }

  const closeContainer = (character) => {
    const frame = stack.pop()
    advance(character)
    finishValue(frame.value, frame.path, frame.capture, frame.start)
  }

  const processStructural = (character) => {
    if (whitespace.test(character)) {
      advance(character)
      return
    }
    const frame = currentFrame()
    if (!frame) {
      if (rootPhase === 'done') throw parseError('Unexpected content after JSON value')
      startValue(character)
      return
    } else if (frame.kind === 'object') {
      if (frame.phase === 'keyOrEnd' || frame.phase === 'key') {
        if (character === '}' && frame.phase === 'keyOrEnd') {
          closeContainer(character)
          return
        }
        if (character !== '"') throw parseError('Expected a JSON object property')
        startString('key')
        return
      }
      if (frame.phase === 'colon') {
        if (character !== ':') throw parseError('Expected : after JSON object property')
        frame.phase = 'value'
        advance(character)
        return
      }
      if (frame.phase === 'value') {
        startValue(character)
        return
      }
      if (character === ',') {
        frame.phase = 'key'
        advance(character)
      } else if (character === '}') closeContainer(character)
      else throw parseError('Expected , or } after JSON object value')
      return
    } else if (frame.phase === 'valueOrEnd' || frame.phase === 'value') {
      if (character === ']' && frame.phase === 'valueOrEnd') {
        closeContainer(character)
        return
      }
      startValue(character)
      return
    } else if (character === ',') {
      frame.phase = 'value'
      advance(character)
    } else if (character === ']') closeContainer(character)
    else throw parseError('Expected , or ] after JSON array value')
  }

  const write = (text) => {
    if (ended || text.length === 0) {
      return
    }
    let index = 0
    while (index < text.length) {
      const consumed = token ? processToken(text[index]) : (processStructural(text[index]), true)
      if (consumed) index++
    }
  }

  const end = () => {
    if (ended) {
      return
    } else {
      if (token?.type === 'number') finishNumber()
      else if (token) throw parseError(`Unexpected end of JSON ${token.type || 'string'}`)
      if (stack.length > 0) throw parseError('Unexpected end of JSON input')
      if (rootPhase !== 'done') throw parseError('Expected a JSON value')
      ended = true
    }
  }

  return { end, write }
}

module.exports = { asLimit, createJsonParser, JsonParseError }