const _ = require('./utils.js')
const _m = module.exports = {}

_m.csv = (opts, s) => {
  opts = {
    quote: '"',
    escape: '"',
    separator: ',',
    encoding: 'utf8',
    header: false,
    ...opts
  }

  function getFirstRow (row) {
    if (opts.header === true) return row
    if (_.isFunction(opts.header)) return opts.header(row)
  }

  function convertRow (row, firstRow) {
    const res = {}
    for (let i = 0, len = firstRow.length; i < len; i++) res[firstRow[i]] = row[i]
    return res
  }

  function storeCell (row, col, colStart, colEnd, handleQuote) {
    row[col] = currentBuffer.slice(colStart, colEnd).toString(opts.encoding)
    if (handleQuote) {
      row[col] = row[col].replace(quoteRegexp, opts.quote)
      return false
    }
  }

  const newLine = Buffer.from('\n', opts.encoding)[0]
  const carriage = Buffer.from('\r', opts.encoding)[0]
  const quote = Buffer.from(opts.quote, opts.encoding)[0]
  const escape = Buffer.from(opts.escape, opts.encoding)[0]
  const separator = Buffer.from(opts.separator, opts.encoding)[0]
  const quoteRegexp = new RegExp(opts.escape + opts.quote, 'g')
  let currentBuffer = Buffer.alloc(0)
  let firstRow = Array.isArray(opts.header) ? opts.header : []
  return s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      currentBuffer = Buffer.concat([currentBuffer, x], currentBuffer.length + x.length)
      let inQuote = false
      let prevIdx = 0
      let row = []
      let col = 0
      let colStart = 0
      let endOffset = 0
      let handleQuote = false
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
                else push(null, convertRow(row, firstRow))
              } else push(null, row)
              row = []
              col = endOffset = 0
              colStart = prevIdx = i + 1
              continue
          }
        } else if (inQuote) {
          if (currentBuffer[i] === escape && currentBuffer[i + 1] === quote) { handleQuote = true; ++i; continue }
          if (currentBuffer[i] === quote) { inQuote = false; endOffset = 1; continue }
        }
      }
      currentBuffer = currentBuffer.slice(prevIdx)
      next()
    }
  })
}
