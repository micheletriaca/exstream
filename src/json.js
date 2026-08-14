const _ = require('./utils.js')
const { asLimit, createJsonParser, JsonParseError } = require('./json-parser.js')
const { parseJsonPath, stringifyPath } = require('./json-path.js')
const { runtime } = require('./runtime.js')
const { createEncodedByteCounter } = require('./byte-counter.js')

class JsonStringifyError extends Error {
  constructor(message, { code = 'EXSTREAM_JSON_STRINGIFY', record } = {}) {
    super(`${message}${record === void 0 ? '' : ` at record ${record}`}`)
    this.name = 'JsonStringifyError'
    this.code = code
    if (record !== void 0) this.record = record
  }
}

const objectOptions = (options, name) => {
  if (options === null || options === void 0) return {}
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw Error(`${name} options must be an object`)
  }
  return options
}

const normalizeEncoding = (options, name) => {
  if (typeof options.encoding !== 'string' || options.encoding.length === 0) {
    throw Error(`${name} encoding must be a non-empty string`)
  }
}

const failParser = (push, error) => {
  push(error)
  push(null, _.nil)
}

const createDecoder = (encoding) => {
  const decoder = runtime.createStringDecoder(encoding)
  let decodingBytes = false
  return {
    end() {
      decodingBytes = false
      return decoder.end()
    },
    write(value) {
      if (typeof value === 'string') {
        if (!decodingBytes) return value
        decodingBytes = false
        return decoder.end() + value
      }
      decodingBytes = true
      return decoder.write(runtime.asBytes(value, encoding))
    },
  }
}

const normalizeJsonOptions = (options) => {
  options = { encoding: 'utf8', maxDepth: Infinity, maxValueBytes: Infinity, path: '$', ...options }
  normalizeEncoding(options, 'json')
  options.maxDepth = asLimit(options.maxDepth, 'json maxDepth')
  options.maxValueBytes = asLimit(options.maxValueBytes, 'json maxValueBytes')
  options.path = parseJsonPath(options.path)
  return options
}

const parseJson = (options, source) => {
  options = normalizeJsonOptions(objectOptions(options, 'json'))
  const decoder = createDecoder(options.encoding)
  let parser
  let currentContext
  return source.consumeSync((error, value, push, context) => {
    if (error) {
      push(error)
      return
    }
    currentContext = value === _.nil ? currentContext : context
    if (!parser) {
      parser = createJsonParser({
        maxDepth: options.maxDepth,
        maxValueBytes: options.maxValueBytes,
        onValue: (parsed) => push(null, parsed, currentContext),
        path: options.path,
      })
    }
    try {
      if (value === _.nil) {
        parser.write(decoder.end())
        parser.end()
        push(null, _.nil)
      } else parser.write(decoder.write(value))
    } catch (reason) {
      failParser(push, reason)
    }
  })
}

const normalizeJsonlOptions = (options) => {
  options = {
    encoding: 'utf8',
    maxDepth: Infinity,
    maxRecordBytes: Infinity,
    skipEmptyLines: true,
    ...options,
  }
  normalizeEncoding(options, 'jsonl')
  if (typeof options.skipEmptyLines !== 'boolean') {
    throw Error('jsonl skipEmptyLines must be a boolean')
  }
  if (options.reviver !== void 0 && typeof options.reviver !== 'function') {
    throw Error('jsonl reviver must be a function')
  }
  options.maxDepth = asLimit(options.maxDepth, 'jsonl maxDepth')
  options.maxRecordBytes = asLimit(options.maxRecordBytes, 'jsonl maxRecordBytes')
  return options
}

const parseLocatedJson = (text, { line, maxDepth, offset, record }) => {
  let parsed
  const parser = createJsonParser({
    baseLine: line,
    baseOffset: offset,
    maxDepth,
    onValue: (value) => {
      parsed = value
    },
    record,
  })
  parser.write(text)
  parser.end()
  return parsed
}

const hasSurrogateSyntax = (text) => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdfff) return true
    if (
      text.charCodeAt(index) === 92 &&
      text.charCodeAt(index + 1) === 117 &&
      /[dD]/.test(text[index + 2] || '') &&
      /[\dA-Fa-f]/.test(text[index + 3] || '')
    ) {
      return true
    }
  }
  return false
}

const parseJsonlRecord = (text, options, location) => {
  if (options.maxDepth !== Infinity) {
    const parsed = parseLocatedJson(text, { ...location, maxDepth: options.maxDepth })
    return options.reviver ? JSON.parse(text, options.reviver) : parsed
  } else if (options.reviver) {
    try {
      JSON.parse(text)
    } catch {
      return parseLocatedJson(text, { ...location, maxDepth: Infinity })
    }
    if (hasSurrogateSyntax(text)) {
      parseLocatedJson(text, { ...location, maxDepth: Infinity })
    }
    return JSON.parse(text, options.reviver)
  } else {
    try {
      const parsed = JSON.parse(text)
      return hasSurrogateSyntax(text)
        ? parseLocatedJson(text, { ...location, maxDepth: Infinity })
        : parsed
    } catch {
      return parseLocatedJson(text, { ...location, maxDepth: Infinity })
    }
  }
}

const createJsonlParser = (options, push, getContext, fail) => {
  const parts = []
  let length = 0
  let line = 1
  let lineOffset = 0
  let inputOffset = 0
  let record = 0
  let skipLineFeed = false
  let ended = false
  const byteCounter =
    options.maxRecordBytes === Infinity ? null : createEncodedByteCounter(options.encoding)

  const append = (text) => {
    if (text.length === 0) return
    parts.push(text)
    length += text.length
    if (byteCounter && byteCounter.add(text) > options.maxRecordBytes) {
      throw new JsonParseError(`JSONL record exceeds maxRecordBytes (${options.maxRecordBytes})`, {
        code: 'EXSTREAM_JSONL_MAX_RECORD_BYTES',
        column: length + 1,
        line,
        offset: lineOffset + length,
        record: record + 1,
      })
    }
  }

  const clear = () => {
    parts.length = 0
    length = 0
    if (byteCounter) byteCounter.reset()
  }

  const emit = () => {
    const text = parts.length < 2 ? parts[0] || '' : parts.join('')
    clear()
    if (/^[\t ]*$/.test(text)) {
      if (options.skipEmptyLines) return
      throw new JsonParseError('Empty JSONL record', {
        code: 'EXSTREAM_JSONL_EMPTY_RECORD',
        column: 1,
        line,
        offset: lineOffset,
        record: record + 1,
      })
    }
    record++
    const parsed = parseJsonlRecord(text, options, { line, offset: lineOffset, record })
    push(null, parsed, getContext())
  }

  const write = (text) => {
    if (ended || text.length === 0) return
    let index = 0
    if (skipLineFeed) {
      skipLineFeed = false
      if (text[0] === '\n') {
        index = 1
        lineOffset = inputOffset + 1
      }
    }
    let start = index
    while (index < text.length) {
      const character = text[index]
      if (character !== '\r' && character !== '\n') {
        index++
        continue
      }
      append(text.slice(start, index))
      emit()
      if (character === '\r' && text[index + 1] === '\n') index++
      else if (character === '\r' && index + 1 === text.length) skipLineFeed = true
      index++
      line++
      lineOffset = inputOffset + index
      start = index
    }
    append(text.slice(start))
    inputOffset += text.length
  }

  const end = () => {
    if (ended) return
    if (length > 0) emit()
    ended = true
    push(null, _.nil)
  }

  return {
    end: () => {
      try {
        end()
      } catch (error) {
        ended = true
        fail(error)
      }
    },
    write: (text) => {
      try {
        write(text)
      } catch (error) {
        ended = true
        fail(error)
      }
    },
  }
}

const parseJsonl = (options, source) => {
  options = normalizeJsonlOptions(objectOptions(options, 'jsonl'))
  const decoder = createDecoder(options.encoding)
  let parser
  let failed = false
  let currentContext
  return source.consumeSync((error, value, push, context) => {
    if (error) {
      push(error)
      return
    }
    if (value !== _.nil) currentContext = context
    if (!parser) {
      parser = createJsonlParser(
        options,
        push,
        () => currentContext,
        (reason) => {
          if (failed) return
          failed = true
          failParser(push, reason)
        },
      )
    }
    try {
      if (value === _.nil) {
        parser.write(decoder.end())
        parser.end()
      } else parser.write(decoder.write(value))
    } catch (reason) {
      failed = true
      failParser(push, reason)
    }
  })
}

const normalizeJsonlStringifyOptions = (options) => {
  options = {
    encoding: 'utf8',
    lineEnding: '\n',
    maxRecordBytes: Infinity,
    ...options,
  }
  normalizeEncoding(options, 'jsonlStringify')
  if (typeof options.lineEnding !== 'string' || options.lineEnding.length === 0) {
    throw Error('jsonlStringify lineEnding must be a non-empty string')
  }
  if (
    options.replacer !== void 0 &&
    typeof options.replacer !== 'function' &&
    !Array.isArray(options.replacer)
  ) {
    throw Error('jsonlStringify replacer must be a function or an array')
  }
  options.maxRecordBytes = asLimit(options.maxRecordBytes, 'jsonlStringify maxRecordBytes')
  return options
}

const serialize = (value, replacer, record) => {
  let serialized
  try {
    serialized = JSON.stringify(value, replacer)
  } catch (reason) {
    throw new JsonStringifyError(`Cannot stringify JSON: ${reason.message}`, { record })
  }
  if (serialized === void 0) {
    throw new JsonStringifyError('JSON value is not serializable', { record })
  }
  return serialized
}

const outputValue = (value, encoding) =>
  encoding === 'utf8' || encoding === 'utf-8' ? value : runtime.bytesFrom(value, encoding)

const jsonlStringify = (options, source) => {
  options = normalizeJsonlStringifyOptions(objectOptions(options, 'jsonlStringify'))
  let record = 0
  return source.consumeSync((error, value, push) => {
    if (error) push(error)
    else if (value === _.nil) push(null, _.nil)
    else {
      record++
      const output = serialize(value, options.replacer, record) + options.lineEnding
      if (
        options.maxRecordBytes !== Infinity &&
        runtime.byteLength(output, options.encoding) > options.maxRecordBytes
      ) {
        throw new JsonStringifyError(
          `JSONL record exceeds maxRecordBytes (${options.maxRecordBytes})`,
          { code: 'EXSTREAM_JSONL_MAX_RECORD_BYTES', record },
        )
      }
      push(null, outputValue(output, options.encoding))
    }
  })
}

const normalizeJsonStringifyOptions = (options) => {
  options = {
    encoding: 'utf8',
    maxValueBytes: Infinity,
    path: '$[*]',
    properties: {},
    ...options,
  }
  normalizeEncoding(options, 'jsonStringify')
  options.maxValueBytes = asLimit(options.maxValueBytes, 'jsonStringify maxValueBytes')
  options.path = stringifyPath(options.path)
  if (
    options.properties === null ||
    typeof options.properties !== 'object' ||
    Array.isArray(options.properties)
  ) {
    throw Error('jsonStringify properties must be an object')
  }
  if (options.finalize !== void 0 && typeof options.finalize !== 'function') {
    throw Error('jsonStringify finalize must be a function')
  }
  if (
    options.replacer !== void 0 &&
    typeof options.replacer !== 'function' &&
    !Array.isArray(options.replacer)
  ) {
    throw Error('jsonStringify replacer must be a function or an array')
  }
  if (
    options.path.length === 0 &&
    (options.finalize || Object.keys(options.properties).length > 0)
  ) {
    throw Error('jsonStringify properties and finalize require an envelope path')
  }
  if (options.path.length > 0 && Object.hasOwn(options.properties, options.path[0])) {
    throw Error(
      `jsonStringify properties collide with path property ${JSON.stringify(options.path[0])}`,
    )
  }
  return options
}

const propertyEntries = (properties, replacer, record) =>
  Object.keys(properties).map(
    (key) => `${JSON.stringify(key)}:${serialize(properties[key], replacer, record)}`,
  )

const envelopeStart = (path, properties, replacer) => {
  if (path.length === 0) return '['
  const entries = propertyEntries(properties, replacer)
  let output = `{${entries.length ? `${entries.join(',')},` : ''}`
  for (let index = 0; index < path.length; index++) {
    output += `${JSON.stringify(path[index])}:`
    output += index + 1 === path.length ? '[' : '{'
  }
  return output
}

const jsonStringify = (options, source) => {
  options = normalizeJsonStringifyOptions(objectOptions(options, 'jsonStringify'))
  const start = envelopeStart(options.path, options.properties, options.replacer)
  let bytesWritten = 0
  let count = 0
  let result
  let stopped = false

  const emit = (push, value) => {
    bytesWritten += runtime.byteLength(value, options.encoding)
    push(null, outputValue(value, options.encoding))
  }

  const serializeRecord = (value) => {
    const record = count + 1
    const output = serialize(value, options.replacer, record)
    if (
      options.maxValueBytes !== Infinity &&
      runtime.byteLength(output, options.encoding) > options.maxValueBytes
    ) {
      throw new JsonStringifyError(`JSON value exceeds maxValueBytes (${options.maxValueBytes})`, {
        code: 'EXSTREAM_JSON_MAX_VALUE_BYTES',
        record,
      })
    }
    count++
    return output
  }

  const finish = async (push) => {
    let finalProperties = {}
    if (options.finalize) {
      finalProperties = await options.finalize({ bytesWritten, count, signal: result.signal })
      if (
        finalProperties === null ||
        typeof finalProperties !== 'object' ||
        Array.isArray(finalProperties)
      ) {
        throw new JsonStringifyError('jsonStringify finalize must return an object')
      }
    } else {
      finalProperties = {}
    }
    if (result.signal.aborted) return
    const collisions = new Set([...Object.keys(options.properties), ...options.path.slice(0, 1)])
    for (const key of Object.keys(finalProperties)) {
      if (collisions.has(key)) {
        throw new JsonStringifyError(
          `jsonStringify final property collides with ${JSON.stringify(key)}`,
        )
      }
    }
    let suffix = ']'
    if (options.path.length > 0) {
      suffix += '}'.repeat(options.path.length - 1)
      const entries = propertyEntries(finalProperties, options.replacer)
      suffix += entries.length > 0 ? `,${entries.join(',')}` : ''
      suffix += '}'
    }
    emit(push, suffix)
    push(null, _.nil)
  }

  result = source.consume((error, value, push, next) => {
    if (stopped) return
    if (error) {
      push(error)
      next()
      return
    }
    if (value !== _.nil) {
      try {
        const serialized = serializeRecord(value)
        emit(push, count === 1 ? start + serialized : `,${serialized}`)
        next()
      } catch (reason) {
        stopped = true
        push(reason)
        push(null, _.nil)
      }
      return
    } else {
      if (count === 0) emit(push, start)
      finish(push).catch((reason) => {
        if (result.signal.aborted) return
        stopped = true
        push(
          reason instanceof JsonStringifyError
            ? reason
            : new JsonStringifyError(`Cannot finalize JSON: ${reason.message || reason}`),
        )
        push(null, _.nil)
      })
    }
  })
  return result
}

const formatOperator = (operation) => {
  const curried = _.curry(operation)
  return function (...args) {
    return args.length === 0 ? curried(null) : curried(...args)
  }
}

module.exports = {
  JsonParseError,
  JsonStringifyError,
  json: formatOperator(parseJson),
  jsonl: formatOperator(parseJsonl),
  jsonlStringify: formatOperator(jsonlStringify),
  jsonStringify: formatOperator(jsonStringify),
}