const _ = require('./utils.js')
const _m = module.exports = {}

_m.csvStringify = (opts, s) => {
  opts = {
    quote: '"',
    escape: '"',
    separator: ',',
    line_ending: '\n',
    encoding: 'utf8',
    header: false,
    quoted: false,
    quoted_empty: false,
    ...opts
  }

  const regexpQuote = new RegExp(_.escapeRegExp(opts.quote[0]), 'g')
  const regexpEscape = new RegExp(_.escapeRegExp(opts.escape[0]), 'g')
  const escapedQuote = opts.escape + opts.quote
  const escapedEscape = opts.escape + opts.escape
  const escapeDifferentFromQuote = opts.escape !== opts.quote

  function findSpecialCharsInCell (x) {
    const res = {
      hasQuote: x.indexOf(opts.quote) >= 0,
      hasEscape: escapeDifferentFromQuote && x.indexOf(opts.escape) >= 0,
      hasOthers: x.indexOf(opts.separator) >= 0 || x.indexOf(opts.line_ending) >= 0
    }
    res.shouldQuote = res.hasEscape || res.hasQuote || res.hasOthers
    return res
  }

  let firstRow = false

  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      if (!firstRow) {
        if (typeof x === 'object') {
          firstRow = Object.keys(x)
          if (opts.header) push(null, Buffer.from(firstRow.join(opts.separator) + opts.line_ending, opts.encoding))
        } else {
          firstRow = Object.keys(x).map(x => parseInt(x))
        }
      }
      const row = Array(x.length)
      for (let i = 0; i < firstRow.length; i++) {
        const col = firstRow[i]
        row[i] = x[col] + ''
        if (!row[i]) {
          if (opts.quoted_empty) row[i] = opts.quote + opts.quote
          else row[i] = ''
          continue
        }
        const k = findSpecialCharsInCell(row[i])
        if (!opts.quoted && !k.shouldQuote) continue
        if (k.hasEscape) row[i] = row[i].replace(regexpEscape, escapedEscape)
        if (k.hasQuote) row[i] = row[i].replace(regexpQuote, escapedQuote)
        row[i] = opts.quote + row[i] + opts.quote
      }
      const res = row.join(opts.separator) + opts.line_ending
      if (opts.encoding !== 'utf8') push(null, Buffer.from(res, opts.encoding))
      else push(null, res)
    }
  })
}

_m.csv = (opts, s) => {
  opts = {
    fastMode: false,
    quote: '"',
    escape: '"',
    separator: ',',
    encoding: 'utf8',
    header: false,
    ...opts
  }

  const newLine = Buffer.from('\n', opts.encoding)[0]
  const carriage = Buffer.from('\r', opts.encoding)[0]
  const quote = Buffer.from(opts.quote, opts.encoding)[0]
  const escape = Buffer.from(opts.escape, opts.encoding)[0]
  const separator = Buffer.from(opts.separator, opts.encoding)[0]
  const quoteRegexp = new RegExp(_.escapeRegExp(opts.escape[0] + opts.quote[0]), 'g')

  function getFirstRow (row) {
    if (opts.header === true) return row
    if (_.isFunction(opts.header)) return opts.header(row)
  }

  function convertObj (row) {
    const res = {}
    for (let i = 0; i < row.length; i++) {
      res[firstRow[i]] = row[i]
    }
    return res
  }

  function storeCell (row, col, colStart, colEnd, handleQuote) {
    const idx = firstRow.length ? firstRow[col] : col
    row[idx] = currentBuffer.toString(opts.encoding, colStart, colEnd)
    if (handleQuote) {
      row[idx] = row[idx].replace(quoteRegexp, opts.quote)
      return false
    }
  }
  let currentBuffer = Buffer.alloc(0)
  let firstRow = Array.isArray(opts.header) ? opts.header : []
  let row = firstRow.length ? {} : []
  let isEnding = false
  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
      return
    } else if (x === _.nil) {
      if (currentBuffer.length === 0) {
        push(null, _.nil)
        return
      } else {
        isEnding = true
        x = Buffer.from('\n')
      }
    }

    currentBuffer = Buffer.concat([currentBuffer, x], currentBuffer.length + x.length)
    let inQuote = false
    let prevIdx = 0
    let col = 0
    let colStart = 0
    let endOffset = 0
    let handleQuote = false
    if (opts.fastMode) {
      let i = 0
      while ((i = currentBuffer.indexOf(newLine, prevIdx)) >= 0) {
        const row = currentBuffer.toString(opts.encoding, prevIdx, i).split(opts.separator)
        if (opts.header) {
          if (!firstRow.length) firstRow = row
          else push(null, convertObj(row))
        } else push(null, row)
        prevIdx = i + 1
      }
    } else {
      for (let i = 0; i < currentBuffer.length; i++) {
        if (!inQuote) {
          switch (currentBuffer[i]) {
            case quote:
              inQuote = true
              colStart = i + 1
              continue
            case separator:
              handleQuote = storeCell(row, col, colStart, i - endOffset, handleQuote)
              ++col
              endOffset = 0
              colStart = i + 1
              continue
            case newLine:
            case carriage:
              while (currentBuffer[i + 1] === newLine || currentBuffer[i + 1] === carriage) { i++; endOffset++ }
              handleQuote = storeCell(row, col, colStart, i - endOffset, handleQuote)
              if (opts.header) {
                if (!firstRow.length) firstRow = getFirstRow(row)
                else push(null, row)
                row = {}
              } else {
                push(null, row)
                row = []
              }
              col = endOffset = 0
              colStart = prevIdx = i + 1
              continue
          }
        } else if (inQuote) {
          if (currentBuffer[i] === escape && currentBuffer[i + 1] === quote) { handleQuote = true; ++i; continue }
          if (currentBuffer[i] === quote) { inQuote = false; endOffset = 1; continue }
        }
      }
    }
    currentBuffer = currentBuffer.slice(prevIdx)
    if (isEnding) push(null, _.nil)
  })
}
