const _ = require('./utils.js')
const _m = module.exports = {}

function replace (str, c, replacement) {
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
  opts = {
    quote: '"',
    escape: '"',
    separator: ',',
    lineEnding: '\n',
    encoding: 'utf8',
    header: false,
    quoted: false,
    quotedEmpty: false,
    // TODO -> FINAL NEWLINE
    ...opts,
  }

  const escapedQuote = opts.escape + opts.quote
  const escapedEscape = opts.escape + opts.escape
  const escapeDifferentFromQuote = opts.escape !== opts.quote
  const doubleQuote = opts.quote + opts.quote

  function checkQuote (x) {
    return (
      typeof x === 'string' && (
        x.indexOf(opts.separator) > -1 ||
        x.indexOf(opts.quote) > -1 ||
        x.indexOf(opts.lineEnding) > -1 ||
        (escapeDifferentFromQuote && x.indexOf(opts.escape) > -1)
      )
    )
  }

  let firstRow = false

  function processCell (x) {
    if (!opts.quoted && !checkQuote(x)) return x
    if (escapeDifferentFromQuote) x = replace(x, opts.escape, escapedEscape)
    return opts.quote + replace(x, opts.quote, escapedQuote) + opts.quote
  }

  function processFirstRow (x, push) {
    const arrayMode = Array.isArray(x)
    const injectedHeader = Array.isArray(opts.header)

    if (!opts.header) {
      firstRow = Object.keys(x)
      processRow(x, push)
    } else if (arrayMode) {
      if (!injectedHeader) throw Error('.csvStringify() called with an invalid header option')
      firstRow = opts.header.map((y, i) => _.isDefined(y) ? i : null).filter(_.isDefined)
      processRow(opts.header, push)
      processRow(x, push)
    } else {
      firstRow = injectedHeader ? firstRow = opts.header : Object.keys(x)
      const rowToPush = firstRow.map(processCell).join(opts.separator) + opts.lineEnding
      if (opts.encoding !== 'utf8') push(null, Buffer.from(rowToPush, opts.encoding))
      else push(null, rowToPush)
      processRow(x, push)
    }
  }

  function processRow (x, push) {
    const row = []
    for (let i = 0, len = firstRow.length; i < len; i++) {
      const cell = x[firstRow[i]] + ''
      if (!cell) row.push(opts.quotedEmpty ? doubleQuote : '')
      else row.push(processCell(cell))
    }
    const res = row.join(opts.separator) + opts.lineEnding
    if (opts.encoding !== 'utf8') push(null, Buffer.from(res, opts.encoding))
    else push(null, res)
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

_m.csv = (opts, s) => {
  opts = {
    fastMode: false,
    quote: '"',
    escape: '"',
    separator: ',',
    encoding: 'utf8',
    header: false,
    ...opts,
  }

  const newLine = Buffer.from('\n', opts.encoding)[0]
  const carriage = Buffer.from('\r', opts.encoding)[0]
  const quote = Buffer.from(opts.quote, opts.encoding)[0]
  const escape = Buffer.from(opts.escape, opts.encoding)[0]
  const separator = Buffer.from(opts.separator, opts.encoding)[0]
  const escapedQuote = opts.escape + opts.quote

  function getFirstRow (row) {
    if (_.isFunction(opts.header)) return opts.header(row)
    else return row
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
      row[idx] = replace(row[idx], escapedQuote, opts.quote)
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
        } else {
          if (currentBuffer[i] === escape && currentBuffer[i + 1] === quote) {
            handleQuote = true
            ++i
          } else if (currentBuffer[i] === quote) {
            inQuote = false
            endOffset = 1
          }
        }
      }
    }
    currentBuffer = currentBuffer.slice(prevIdx)
    if (isEnding) push(null, _.nil)
  })
}
