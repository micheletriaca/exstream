/*
  eslint-disable max-lines,
  sonarjs/cognitive-complexity,
  complexity,
  no-sync,
  max-lines-per-function,
*/

const _ = require('./utils.js')
const { asLimit, CsvParseError, isSingleCharacter, parseCsv } = require('./csv-parser.js')
const { runtime } = require('./runtime.js')
const { bytesFrom } = runtime

class CsvStringifyError extends Error {
  constructor(message, { code = 'EXSTREAM_CSV_STRINGIFY', column, record } = {}) {
    super(`${message} at record ${record}${column === void 0 ? '' : `, column ${column}`}`)
    this.name = 'CsvStringifyError'
    this.code = code
    this.column = column
    this.record = record
  }
}

const _m = (module.exports = { CsvParseError, CsvStringifyError })

function replace(str, c, replacement) {
  let outstr = ''
  const len = c.length
  let start = -len
  let end = 0
  while ((end = str.indexOf(c, (start += len))) > -1) {
    outstr += str.slice(start, end) + replacement
    start = end
  }
  return outstr + str.slice(start)
}

_m.csvStringify = (opts, s) => {
  if (opts === null || opts === void 0) opts = {}
  if (typeof opts !== 'object' || Array.isArray(opts)) {
    throw Error('csvStringify options must be an object')
  }
  opts = {
    quote: '"',
    escape: '"',
    separator: ',',
    lineEnding: '\n',
    encoding: 'utf8',
    header: false,
    quoted: false,
    quotedEmpty: false,
    maxColumns: Infinity,
    maxRecordBytes: Infinity,
    // TODO -> FINAL NEWLINE
    ...opts,
  }
  if (typeof opts.separator !== 'string' || opts.separator.length === 0) {
    throw Error('csvStringify separator must be a non-empty string')
  }
  if (opts.separator.includes('\r') || opts.separator.includes('\n')) {
    throw Error('csvStringify separator cannot contain a newline')
  }
  if (!isSingleCharacter(opts.quote)) {
    throw Error('csvStringify quote must be a single character')
  }
  if (!isSingleCharacter(opts.escape)) {
    throw Error('csvStringify escape must be a single character')
  }
  if (typeof opts.lineEnding !== 'string' || opts.lineEnding.length === 0) {
    throw Error('csvStringify lineEnding must be a non-empty string')
  }
  if (typeof opts.encoding !== 'string' || opts.encoding.length === 0) {
    throw Error('csvStringify encoding must be a non-empty string')
  }
  if (typeof opts.header !== 'boolean' && !Array.isArray(opts.header)) {
    throw Error('csvStringify header must be a boolean or an array')
  }
  if (typeof opts.quoted !== 'boolean') throw Error('csvStringify quoted must be a boolean')
  if (typeof opts.quotedEmpty !== 'boolean') {
    throw Error('csvStringify quotedEmpty must be a boolean')
  }
  opts.maxColumns = asLimit(opts.maxColumns, 'csvStringify maxColumns')
  opts.maxRecordBytes = asLimit(opts.maxRecordBytes, 'csvStringify maxRecordBytes')

  const escapedQuote = opts.escape + opts.quote
  const escapedEscape = opts.escape + opts.escape
  const escapeDifferentFromQuote = opts.escape !== opts.quote
  const doubleQuote = opts.quote + opts.quote

  function checkQuote(x) {
    return (
      typeof x === 'string' &&
      (x.indexOf(opts.separator) > -1 ||
        x.indexOf(opts.quote) > -1 ||
        x.indexOf('\r') > -1 ||
        x.indexOf('\n') > -1 ||
        (escapeDifferentFromQuote && x.indexOf(opts.escape) > -1))
    )
  }

  let firstRow = false
  let record = 0

  const pushRecord = (value, push) => {
    if (opts.maxRecordBytes !== Infinity) {
      record++
      const bytes = runtime.byteLength(value, opts.encoding)
      if (bytes > opts.maxRecordBytes) {
        throw new CsvStringifyError(`CSV record exceeds maxRecordBytes (${opts.maxRecordBytes})`, {
          code: 'EXSTREAM_CSV_MAX_RECORD_BYTES',
          record,
        })
      }
    }
    if (opts.encoding !== 'utf8') push(null, bytesFrom(value, opts.encoding))
    else push(null, value)
  }

  const validateColumns = () => {
    if (firstRow.length > opts.maxColumns) {
      throw new CsvStringifyError(`CSV record exceeds maxColumns (${opts.maxColumns})`, {
        code: 'EXSTREAM_CSV_MAX_COLUMNS',
        column: opts.maxColumns + 1,
        record: record + 1,
      })
    }
  }

  function processCell(x) {
    if (!opts.quoted && !checkQuote(x)) return x
    x = String(x)
    if (escapeDifferentFromQuote) x = replace(x, opts.escape, escapedEscape)
    return opts.quote + replace(x, opts.quote, escapedQuote) + opts.quote
  }

  function processRow(x, push) {
    const row = Array(firstRow.length)
    for (let i = 0, len = firstRow.length; i < len; i++) {
      const cell = x[firstRow[i]] + ''
      if (!cell) row[i] = opts.quotedEmpty ? doubleQuote : ''
      else row[i] = processCell(cell)
    }
    const res = row.join(opts.separator) + opts.lineEnding
    pushRecord(res, push)
  }

  function processFirstRow(x, push) {
    const arrayMode = Array.isArray(x)
    const injectedHeader = Array.isArray(opts.header)

    if (!opts.header) {
      firstRow = Object.keys(x)
      if (arrayMode) firstRow = firstRow.map((x) => parseInt(x))
      validateColumns()
      processRow(x, push)
    } else if (arrayMode) {
      if (!injectedHeader) throw Error('.csvStringify() called with an invalid header option')
      firstRow = opts.header.map((y, i) => (_.isDefined(y) ? i : null)).filter(_.isDefined)
      validateColumns()
      processRow(opts.header, push)
      processRow(x, push)
    } else {
      firstRow = injectedHeader ? opts.header : Object.keys(x)
      validateColumns()
      const rowToPush = firstRow.map(processCell).join(opts.separator) + opts.lineEnding
      pushRecord(rowToPush, push)
      processRow(x, push)
    }
  }

  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(null, _.nil)
    } else if (!firstRow) {
      processFirstRow(x, push)
    } else {
      processRow(x, push)
    }
  })
}

_m.csv = (opts, s) => parseCsv(opts, s)