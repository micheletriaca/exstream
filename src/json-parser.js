const { JSON_PATH_WILDCARD, parseJsonPath } = require('./json-path.js')
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
// oxlint-disable-next-line no-control-regex -- control characters end the safe string span
const stringSpecialCharacter = /["\\\u0000-\u001f\uD800-\uDFFF]/g
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

  const beginValueCount = () => {
    if (maxValueBytes === Infinity) return
    valueCounter = createUtf8ByteCounter(maxValueBytes, () => {
      throw parseError(
        `JSON value exceeds maxValueBytes (${maxValueBytes})`,
        'EXSTREAM_JSON_MAX_VALUE_BYTES',
      )
    })
  }

  const finishValue = (value, selected, capture, start) => {
    if (selected) {
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
      value = token.escapedSyntax ? JSON.parse(token.raw) : token.raw
    } else {
      value = void 0
    }
    if (token.role === 'key') {
      const frame = currentFrame()
      frame.key = value
      frame.phase = 'colon'
    } else {
      finishValue(value, token.selected, token.capture, token.start)
    }
    token = null
  }

  const finishNumber = () => {
    if (!numberPattern.test(token.raw)) throw parseError('Invalid JSON number')
    const value = Number(token.raw)
    finishValue(value, token.selected, token.capture, token.start)
    token = null
  }

  const startString = (role, selected, capture) => {
    token = {
      capture,
      collect: role === 'key' || capture,
      escaped: false,
      escapedSyntax: false,
      raw: '',
      role,
      selected,
      start: location(),
      unicode: 0,
      unicodeValue: 0,
      pendingHighSurrogate: false,
    }
    advance('"')
  }

  const startValue = (character) => {
    const parent = currentFrame()
    let depth = 0
    let prefixMatched = true
    if (parent) {
      depth = parent.depth + 1
      const segment = parent.kind === 'array' ? parent.index : parent.key
      const expected = selectedPath[depth - 1]
      prefixMatched =
        parent.prefixMatched &&
        depth <= selectedPath.length &&
        (expected === JSON_PATH_WILDCARD || expected === segment)
    }
    const selected = prefixMatched && depth === selectedPath.length
    const capture = Boolean(parent?.capture) || selected
    const start = location()
    if (selected) beginValueCount()
    if (character === '{' || character === '[') {
      if (stack.length + 1 > maxDepth) {
        throw parseError(`JSON exceeds maxDepth (${maxDepth})`, 'EXSTREAM_JSON_MAX_DEPTH')
      } else {
        stack.push({
          capture,
          depth,
          index: 0,
          key: null,
          kind: character === '{' ? 'object' : 'array',
          phase: character === '{' ? 'keyOrEnd' : 'valueOrEnd',
          prefixMatched,
          selected,
          start,
          value: capture ? (character === '{' ? {} : []) : void 0,
        })
        advance(character)
      }
      return
    } else if (character === '"') {
      startString('value', selected, capture)
      return
    } else {
      const code = character.charCodeAt(0)
      if (character !== '-' && (code < 0x30 || code > 0x39)) {
        if (character in literals) {
          const [expected, value] = literals[character]
          token = {
            capture,
            expected,
            index: 1,
            selected,
            start,
            type: 'literal',
            value,
          }
          advance(character)
          return
        }
        throw parseError('Expected a JSON value')
      }
      token = { capture, raw: character, selected, start, type: 'number' }
      advance(character)
      return
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
      const code = character.charCodeAt(0)
      if (
        (code < 0x30 || code > 0x39) &&
        code !== 0x45 &&
        code !== 0x2b &&
        code !== 0x2e &&
        code !== 0x65 &&
        code !== 0x2d
      ) {
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
        finishValue(completed.value, completed.selected, completed.capture, completed.start)
        return true
      }
    }
    const code = character.charCodeAt(0)
    if (token.unicode > 0) {
      if (token.collect) token.raw += character
      let hex
      if (code >= 0x30 && code <= 0x39) hex = code - 0x30
      else if (code >= 0x41 && code <= 0x46) hex = code - 0x37
      else if (code >= 0x61 && code <= 0x66) hex = code - 0x57
      else hex = -1
      if (hex < 0) {
        throw parseError('Invalid Unicode escape in JSON string')
      } else {
        token.unicodeValue = token.unicodeValue * 16 + hex
        token.unicode--
        advance(character)
        if (token.unicode === 0) acceptCodeUnit(token, token.unicodeValue)
        return true
      }
    } else if (token.escaped) {
      if (token.collect) token.raw += character
      if (
        code !== 0x22 &&
        code !== 0x2f &&
        code !== 0x5c &&
        code !== 0x62 &&
        code !== 0x66 &&
        code !== 0x6e &&
        code !== 0x72 &&
        code !== 0x74 &&
        code !== 0x75
      ) {
        throw parseError('Invalid escape in JSON string')
      } else {
        token.escaped = false
        if (character === 'u') {
          token.unicode = 4
          token.unicodeValue = 0
        } else acceptCodeUnit(token, code)
        advance(character)
        return true
      }
    } else if (character === '"') {
      if (token.pendingHighSurrogate) {
        throw parseError('Unpaired high surrogate in JSON string')
      }
      if (token.collect && token.escapedSyntax) token.raw += character
      advance(character)
      finishString()
      return true
    } else if (character === '\\') {
      if (token.collect) {
        if (!token.escapedSyntax) token.raw = `"${token.raw}`
        token.raw += character
      }
      token.escapedSyntax = true
      token.escaped = true
      advance(character)
      return true
    } else if (code < 0x20) {
      throw parseError('Control character in JSON string')
    } else {
      if (token.collect) token.raw += character
      acceptCodeUnit(token, code)
      advance(character)
      return true
    }
  }

  const processStringSpan = (text, start) => {
    stringSpecialCharacter.lastIndex = start
    const special = stringSpecialCharacter.exec(text)
    const end = special ? special.index : text.length
    if (end === start) return start
    if (token.collect) token.raw += text.slice(start, end)
    const length = end - start
    offset += length
    column += length
    previousCarriage = false
    return end
  }

  const closeContainer = (character) => {
    const frame = stack.pop()
    advance(character)
    finishValue(frame.value, frame.selected, frame.capture, frame.start)
  }

  const processStructural = (character) => {
    const code = character.charCodeAt(0)
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
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
      if (!token) {
        processStructural(text[index])
        index++
        continue
      }
      if (
        token.role &&
        !token.escaped &&
        token.unicode === 0 &&
        !token.pendingHighSurrogate &&
        !valueCounter
      ) {
        const end = processStringSpan(text, index)
        if (end !== index) {
          index = end
          continue
        }
      }
      if (processToken(text[index])) index++
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