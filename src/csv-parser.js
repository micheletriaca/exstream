const _ = require('./utils.js')
const { runtime } = require('./runtime.js')
const { annotateError } = require('./error-info.js')

class CsvParseError extends Error {
  constructor(message, { code = 'EXSTREAM_CSV_PARSE', column, line, offset, record } = {}) {
    super(`${message} at line ${line}, column ${column}`)
    this.name = 'CsvParseError'
    this.code = code
    this.column = column
    this.line = line
    this.offset = offset
    this.record = record
  }
}

const asLimit = (value, name) => {
  if (value === void 0 || value === Infinity) return Infinity
  let number
  try {
    number = Number(value)
  } catch {
    number = NaN
  }
  if (!Number.isInteger(number) || number <= 0) {
    throw Error(`${name} must be a positive integer or Infinity`)
  }
  return number
}

const isSingleCharacter = (value) =>
  typeof value === 'string' && value.length > 0 && [...value].length === 1

const maxInlineCellParts = 8
const maxInlineCellLength = 4 * 1024

const normalizeOptions = (options) => {
  if (options === null || options === void 0) options = {}
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw Error('csv options must be an object')
  }
  const normalized = {
    encoding: 'utf8',
    escape: '"',
    fastMode: false,
    header: false,
    maxColumns: Infinity,
    maxRecordBytes: Infinity,
    quote: '"',
    separator: ',',
    skipEmptyLines: true,
    ...options,
  }
  if (typeof normalized.encoding !== 'string' || normalized.encoding.length === 0) {
    throw Error('csv encoding must be a non-empty string')
  }
  if (typeof normalized.separator !== 'string' || normalized.separator.length === 0) {
    throw Error('csv separator must be a non-empty string')
  }
  if (normalized.separator.includes('\r') || normalized.separator.includes('\n')) {
    throw Error('csv separator cannot contain a newline')
  }
  if (!isSingleCharacter(normalized.quote)) {
    throw Error('csv quote must be a single character')
  }
  if (!isSingleCharacter(normalized.escape)) {
    throw Error('csv escape must be a single character')
  }
  if (typeof normalized.fastMode !== 'boolean') throw Error('csv fastMode must be a boolean')
  if (typeof normalized.skipEmptyLines !== 'boolean') {
    throw Error('csv skipEmptyLines must be a boolean')
  }
  if (
    typeof normalized.header !== 'boolean' &&
    !Array.isArray(normalized.header) &&
    typeof normalized.header !== 'function'
  ) {
    throw Error('csv header must be a boolean, an array, or a function')
  }
  normalized.maxColumns = asLimit(normalized.maxColumns, 'csv maxColumns')
  normalized.maxRecordBytes = asLimit(normalized.maxRecordBytes, 'csv maxRecordBytes')
  return normalized
}

const createParser = (options, push, fail) => {
  const escapeQuote = options.escape + options.quote
  const escapeEscape = options.escape + options.escape
  const escapeDifferentFromQuote = options.escape !== options.quote
  const partialTokenWindow = Math.max(
    2,
    options.separator.length,
    escapeQuote.length,
    escapeDifferentFromQuote ? escapeEscape.length : 0,
  )
  const quoteCode = options.quote.length === 1 ? options.quote.charCodeAt(0) : -1
  const escapeCode = options.escape.length === 1 ? options.escape.charCodeAt(0) : -1
  const separatorCode = options.separator.length === 1 ? options.separator.charCodeAt(0) : -1
  const quoteAt =
    quoteCode >= 0
      ? (text, index) => text.charCodeAt(index) === quoteCode
      : (text, index) => text.startsWith(options.quote, index)
  const separatorAt =
    separatorCode >= 0
      ? (text, index) => text.charCodeAt(index) === separatorCode
      : (text, index) => text.startsWith(options.separator, index)
  const escapeQuoteAt =
    escapeCode >= 0 && quoteCode >= 0
      ? (text, index) =>
          text.charCodeAt(index) === escapeCode && text.charCodeAt(index + 1) === quoteCode
      : (text, index) => text.startsWith(escapeQuote, index)
  const escapeEscapeAt =
    escapeCode >= 0
      ? (text, index) =>
          text.charCodeAt(index) === escapeCode && text.charCodeAt(index + 1) === escapeCode
      : (text, index) => text.startsWith(escapeEscape, index)
  let headers = Array.isArray(options.header) && options.header.length > 0 ? options.header : null
  let pending = ''
  let cell = ''
  let cellParts = null
  let cellPartCount = 0
  let row = []
  let inQuotes = false
  let afterQuote = false
  let quotedField = false
  let recordHasContent = false
  let recordBytes = 0
  let line = 1
  let column = 1
  let offset = 0
  let record = 1
  let ended = false

  const location = (code) => ({ code, column, line, offset, record })

  const parseError = (message, code) => new CsvParseError(message, location(code))

  const addRecordBytes = (text) => {
    if (options.maxRecordBytes === Infinity || text.length === 0) return
    recordBytes += runtime.byteLength(text, options.encoding)
    if (recordBytes > options.maxRecordBytes) {
      throw parseError(
        `CSV record exceeds maxRecordBytes (${options.maxRecordBytes})`,
        'EXSTREAM_CSV_MAX_RECORD_BYTES',
      )
    }
  }

  const advance = (text, nextCarriage = text.indexOf('\r'), nextLineFeed = text.indexOf('\n')) => {
    offset += text.length
    if (nextCarriage < 0 && nextLineFeed < 0) {
      column += text.length
      return
    }
    let start = 0
    while (nextCarriage >= 0 || nextLineFeed >= 0) {
      let index
      if (nextCarriage >= 0 && (nextLineFeed < 0 || nextCarriage < nextLineFeed)) {
        index = nextCarriage
        nextCarriage = text.indexOf('\r', nextCarriage + 1)
        if (nextLineFeed === index + 1) {
          index = nextLineFeed
          nextLineFeed = text.indexOf('\n', nextLineFeed + 1)
        }
      } else {
        index = nextLineFeed
        nextLineFeed = text.indexOf('\n', nextLineFeed + 1)
      }
      line++
      column = 1
      start = index + 1
    }
    column += text.length - start
  }

  const consumeRaw = (text, nextCarriage, nextLineFeed) => {
    addRecordBytes(text)
    advance(text, nextCarriage, nextLineFeed)
    recordHasContent = true
  }

  const consumePlain = (text) => {
    addRecordBytes(text)
    offset += text.length
    column += text.length
    if (text.length > 0) recordHasContent = true
  }

  const quoteHasLineBreak = options.quote === '\r' || options.quote === '\n'
  const escapeQuoteHasLineBreak =
    options.escape === '\r' || options.escape === '\n' || quoteHasLineBreak
  const escapeEscapeHasLineBreak = options.escape === '\r' || options.escape === '\n'

  const appendCell = (text) => {
    if (text.length === 0) return
    if (cellParts !== null) {
      cellParts.push(text)
      return
    }
    if (cell.length === 0) {
      cell = text
      cellPartCount = 1
      return
    }
    if (cellPartCount < maxInlineCellParts && cell.length + text.length <= maxInlineCellLength) {
      cell += text
      cellPartCount++
      return
    }
    cellParts = [cell, text]
    cell = ''
  }

  const emitCell = () => {
    if (row.length >= options.maxColumns) {
      throw parseError(
        `CSV record exceeds maxColumns (${options.maxColumns})`,
        'EXSTREAM_CSV_MAX_COLUMNS',
      )
    }
    const value = cellParts === null ? cell : cellParts.join('')
    cell = ''
    cellParts = null
    cellPartCount = 0
    row.push(value)
    quotedField = false
    afterQuote = false
  }

  const pushRow = (completedRow, hasContent) => {
    const skip =
      options.skipEmptyLines && !hasContent && completedRow.length === 1 && completedRow[0] === ''
    if (!skip) {
      if (options.header && headers === null) {
        headers = typeof options.header === 'function' ? options.header(completedRow) : completedRow
        if (!Array.isArray(headers)) throw parseError('CSV header function must return an array')
      } else if (headers === null) {
        push(null, completedRow)
      } else {
        const value = {}
        for (let index = 0; index < completedRow.length; index++) {
          value[headers[index]] = completedRow[index]
        }
        push(null, value)
      }
    }
  }

  const emitRow = () => {
    emitCell()
    pushRow(row, recordHasContent)
    row = []
    recordHasContent = false
    recordBytes = 0
    record++
  }

  const firstColumnBeyondBytes = (text, limit) => {
    let low = 1
    let high = text.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (runtime.byteLength(text.slice(0, middle), options.encoding) > limit) high = middle
      else low = middle + 1
    }
    return low
  }

  const directPlainRow = (text, delimiter) => {
    if (options.maxRecordBytes !== Infinity) {
      const length = runtime.byteLength(text, options.encoding)
      if (length > options.maxRecordBytes) {
        column = firstColumnBeyondBytes(text, options.maxRecordBytes)
        throw parseError(
          `CSV record exceeds maxRecordBytes (${options.maxRecordBytes})`,
          'EXSTREAM_CSV_MAX_RECORD_BYTES',
        )
      }
    }
    const completedRow = text.split(options.separator)
    if (completedRow.length > options.maxColumns) {
      column = text.length + 1
      throw parseError(
        `CSV record exceeds maxColumns (${options.maxColumns})`,
        'EXSTREAM_CSV_MAX_COLUMNS',
      )
    }
    pushRow(completedRow, text.length > 0)
    offset += text.length + delimiter.length
    line++
    column = 1
    record++
  }

  const consumeRecordDelimiter = (text) => {
    emitRow()
    offset += text.length
    line++
    column = 1
  }

  const isPartialTokenAt = (text, index, token) => {
    const remaining = text.length - index
    if (remaining >= token.length) return false
    for (let offset = 0; offset < remaining; offset++) {
      if (text.charCodeAt(index + offset) !== token.charCodeAt(offset)) return false
    }
    return true
  }

  const partialTokenAt = (text, index) => {
    const remaining = text.length - index
    if (remaining === 1 && text.charCodeAt(index) === 13) return true
    if (!inQuotes && isPartialTokenAt(text, index, options.separator)) return true
    return (
      inQuotes &&
      (isPartialTokenAt(text, index, escapeQuote) ||
        (escapeDifferentFromQuote && isPartialTokenAt(text, index, escapeEscape)))
    )
  }

  const bufferPartialToken = (text, index, flush) => {
    const start = Math.max(index, text.length - partialTokenWindow + 1)
    for (let candidate = start; candidate < text.length; candidate++) {
      if (!partialTokenAt(text, candidate)) continue
      flush(candidate)
      pending = text.slice(candidate)
      return true
    }
    return false
  }

  const processText = (input, final = false) => {
    const text = pending.length === 0 ? input : pending + input
    pending = ''
    let index = 0
    let segmentStart = 0
    const tokenOrEnd = (value) => (value < 0 ? text.length : value)
    let nextSeparator = tokenOrEnd(text.indexOf(options.separator))
    let nextCarriage = tokenOrEnd(text.indexOf('\r'))
    let nextLineFeed = tokenOrEnd(text.indexOf('\n'))

    const flush = (end) => {
      if (end > segmentStart) {
        const part = text.slice(segmentStart, end)
        appendCell(part)
        if (inQuotes) {
          if (nextCarriage < segmentStart)
            nextCarriage = tokenOrEnd(text.indexOf('\r', segmentStart))
          if (nextLineFeed < segmentStart)
            nextLineFeed = tokenOrEnd(text.indexOf('\n', segmentStart))
          if (nextCarriage < end || nextLineFeed < end) {
            consumeRaw(
              part,
              nextCarriage < end ? nextCarriage - segmentStart : -1,
              nextLineFeed < end ? nextLineFeed - segmentStart : -1,
            )
          } else consumePlain(part)
        } else consumePlain(part)
      }
      segmentStart = end
    }

    while (index < text.length) {
      if (!final && text.length - index < partialTokenWindow && partialTokenAt(text, index)) {
        flush(index)
        pending = text.slice(index)
        return
      }

      if (inQuotes) {
        let nextQuote = text.indexOf(options.quote, index)
        let nextEscape = escapeDifferentFromQuote ? text.indexOf(options.escape, index) : -1
        if (nextQuote < 0 || (nextEscape >= 0 && nextEscape < nextQuote)) nextQuote = nextEscape
        if (nextQuote < 0) {
          if (!final && bufferPartialToken(text, index, flush)) return
          break
        }
        index = nextQuote
        if (!final && text.length - index < partialTokenWindow && partialTokenAt(text, index)) {
          flush(index)
          pending = text.slice(index)
          return
        }
        if (escapeQuoteAt(text, index)) {
          flush(index)
          appendCell(options.quote)
          if (escapeQuoteHasLineBreak) consumeRaw(escapeQuote)
          else consumePlain(escapeQuote)
          index += escapeQuote.length
          segmentStart = index
          continue
        }
        if (escapeDifferentFromQuote && escapeEscapeAt(text, index)) {
          flush(index)
          appendCell(options.escape)
          if (escapeEscapeHasLineBreak) consumeRaw(escapeEscape)
          else consumePlain(escapeEscape)
          index += escapeEscape.length
          segmentStart = index
          continue
        }
        if (quoteAt(text, index)) {
          flush(index)
          if (quoteHasLineBreak) consumeRaw(options.quote)
          else consumePlain(options.quote)
          index += options.quote.length
          segmentStart = index
          inQuotes = false
          afterQuote = true
          continue
        }
        index += options.escape.length
        continue
      }

      if (afterQuote) {
        if (separatorAt(text, index)) {
          flush(index)
          consumePlain(options.separator)
          emitCell()
          index += options.separator.length
          segmentStart = index
          continue
        }
        const character = text[index]
        if (character === '\r' || character === '\n') {
          flush(index)
          const delimiter = character === '\r' && text[index + 1] === '\n' ? '\r\n' : character
          consumeRecordDelimiter(delimiter)
          index += delimiter.length
          segmentStart = index
          continue
        }
        throw parseError('Unexpected character after closing CSV quote')
      }

      const nextQuote = options.fastMode ? -1 : text.indexOf(options.quote, index)
      if (nextSeparator < index) {
        nextSeparator = tokenOrEnd(text.indexOf(options.separator, index))
      }
      if (nextCarriage < index) {
        nextCarriage = tokenOrEnd(text.indexOf('\r', index))
      }
      if (nextLineFeed < index) {
        nextLineFeed = tokenOrEnd(text.indexOf('\n', index))
      }
      const nextToken = Math.min(tokenOrEnd(nextQuote), nextSeparator, nextCarriage, nextLineFeed)
      if (nextToken === text.length) {
        if (!final && bufferPartialToken(text, index, flush)) return
        break
      }
      index = nextToken

      if (!options.fastMode && quoteAt(text, index)) {
        flush(index)
        if (cell.length > 0 || cellParts !== null) {
          throw parseError('Unexpected quote in unquoted CSV field')
        }
        if (quoteHasLineBreak) consumeRaw(options.quote)
        else consumePlain(options.quote)
        index += options.quote.length
        segmentStart = index
        inQuotes = true
        quotedField = true
        continue
      }

      if (separatorAt(text, index)) {
        flush(index)
        consumePlain(options.separator)
        emitCell()
        index += options.separator.length
        segmentStart = index
        continue
      }

      const character = text[index]
      flush(index)
      const delimiter = character === '\r' && text[index + 1] === '\n' ? '\r\n' : character
      consumeRecordDelimiter(delimiter)
      index += delimiter.length
      segmentStart = index
    }

    flush(text.length)
  }

  const writeText = (text) => {
    if (ended) return
    try {
      processText(text)
    } catch (error) {
      ended = true
      fail(error)
    }
  }

  const end = () => {
    if (ended) return
    try {
      processText('', true)
      if (inQuotes) {
        throw parseError('Unterminated quoted CSV field', 'EXSTREAM_CSV_UNTERMINATED_QUOTE')
      }
      if (
        recordHasContent ||
        cell.length > 0 ||
        cellParts !== null ||
        row.length > 0 ||
        quotedField
      ) {
        emitRow()
      }
      ended = true
      push(null, _.nil)
    } catch (error) {
      ended = true
      fail(error)
    }
  }

  return { directPlainRow, end, writeText }
}

const createByteRouter = (options, parser) => {
  const decoder = runtime.createStringDecoder(options.encoding)
  const newline = runtime.bytesFrom('\n', options.encoding)
  const carriage = runtime.bytesFrom('\r', options.encoding)
  const quote = runtime.bytesFrom(options.quote, options.encoding)
  const canRouteBytes = newline.length === 1 && carriage.length === 1 && quote.length === 1
  const lineParts = []
  let lineLength = 0
  let pendingCarriage = false
  let textRouting = false

  const decode = (bytes) => runtime.bytesToString(bytes, options.encoding, 0, bytes.length)

  const joinLine = (part) => {
    if (lineParts.length === 0) return part
    const parts = part.length === 0 ? lineParts : [...lineParts, part]
    return runtime.concatTextBytes(parts, lineLength + part.length)
  }

  const routeLine = (bytes, delimiter) => parser.directPlainRow(decode(bytes), delimiter)

  const clearLine = () => {
    lineParts.length = 0
    lineLength = 0
  }

  const routeBufferedLine = (part, delimiter) => {
    routeLine(joinLine(part), delimiter)
    clearLine()
  }

  const appendLinePart = (part) => {
    if (part.length === 0) return
    lineParts.push(part)
    lineLength += part.length
  }

  const routeText = (bytes) => {
    const input = joinLine(bytes)
    clearLine()
    parser.writeText(decoder.write(input))
    textRouting = true
  }

  const routeLfOnly = (bytes, initialStart) => {
    let start = initialStart
    let end
    while ((end = runtime.indexOfByte(bytes, newline[0], start)) >= 0) {
      const part = bytes.subarray(start, end)
      if (lineParts.length === 0) routeLine(part, '\n')
      else routeBufferedLine(part, '\n')
      start = end + 1
    }
    appendLinePart(bytes.subarray(start))
  }

  const routeWithCarriages = (bytes, initialStart) => {
    let start = initialStart
    while (start < bytes.length) {
      const nextLineFeed = runtime.indexOfByte(bytes, newline[0], start)
      const nextCarriage = runtime.indexOfByte(bytes, carriage[0], start)
      let end
      if (nextLineFeed < 0) end = nextCarriage
      else if (nextCarriage < 0) end = nextLineFeed
      else end = Math.min(nextLineFeed, nextCarriage)

      if (end < 0) {
        appendLinePart(bytes.subarray(start))
        return
      }
      const part = bytes.subarray(start, end)
      if (bytes[end] === newline[0]) {
        routeBufferedLine(part, '\n')
        start = end + 1
      } else if (end + 1 === bytes.length) {
        appendLinePart(part)
        pendingCarriage = true
        return
      } else if (bytes[end + 1] === newline[0]) {
        routeBufferedLine(part, '\r\n')
        start = end + 2
      } else {
        routeBufferedLine(part, '\r')
        start = end + 1
      }
    }
  }

  const write = (value) => {
    const bytes = runtime.asBytes(value, options.encoding)
    if (!canRouteBytes) {
      parser.writeText(decoder.write(bytes))
      return
    }
    if (textRouting) {
      parser.writeText(decoder.write(bytes))
      return
    }

    let start = 0
    if (pendingCarriage) {
      pendingCarriage = false
      const isCrLf = bytes[0] === newline[0]
      routeBufferedLine(runtime.bytesFrom([]), isCrLf ? '\r\n' : '\r')
      if (isCrLf) start = 1
    }
    if (!options.fastMode && runtime.indexOfByte(bytes, quote[0], start) >= 0) {
      routeText(bytes.subarray(start))
      return
    }
    if (runtime.indexOfByte(bytes, carriage[0], start) < 0) routeLfOnly(bytes, start)
    else routeWithCarriages(bytes, start)
  }

  const end = () => {
    if (!canRouteBytes) {
      parser.writeText(decoder.end())
      parser.end()
      return
    }
    if (textRouting) {
      parser.writeText(decoder.end())
      parser.end()
      return
    }
    if (pendingCarriage) {
      pendingCarriage = false
      routeBufferedLine(runtime.bytesFrom([]), '\r')
    }
    if (lineLength > 0) parser.writeText(decode(joinLine(runtime.bytesFrom([]))))
    parser.end()
  }

  return { end, write }
}

const parseCsv = (options, source) => {
  options = normalizeOptions(options)
  let parser
  let result
  let failed = false
  result = source.consumeSync((error, value, push) => {
    if (failed) return
    if (error) {
      push(error)
      return
    }
    if (!parser) {
      parser = createParser(options, push, (reason) => {
        failed = true
        annotateError(reason, { origin: 'format', stage: 'csv' })
        try {
          push(reason)
        } finally {
          result.abort(reason)
        }
      })
      parser = createByteRouter(options, parser)
    }
    if (value === _.nil) parser.end()
    else parser.write(value)
  })
  return result
}

module.exports = { asLimit, CsvParseError, isSingleCharacter, normalizeOptions, parseCsv }