const { parse } = require('csv-parse/sync')
const _ = require('../src/index.js')

test('csvStringify quotes CR and LF independently from the configured line ending', () => {
  const rows = [
    ['line\nfeed', 'carriage\rreturn', 'both\r\ncharacters'],
    ['plain', 'value', 'row'],
  ]
  const serialized = _(rows).csvStringify({ lineEnding: '\r\n' }).values().join('')

  expect(parse(serialized, { record_delimiter: '\r\n' })).toEqual(rows)
})

test('csvStringify maxColumns reports output record and column', () => {
  expect(() =>
    _([[1, 2, 3]])
      .csvStringify({ maxColumns: 2 })
      .values(),
  ).toThrowError(
    expect.objectContaining({
      code: 'EXSTREAM_CSV_MAX_COLUMNS',
      column: 3,
      name: 'CsvStringifyError',
      record: 1,
    }),
  )
})

test('csvStringify maxRecordBytes includes delimiters and the line ending', () => {
  expect(() =>
    _([['123', '45']])
      .csvStringify({ maxRecordBytes: 6 })
      .values(),
  ).toThrowError(
    expect.objectContaining({
      code: 'EXSTREAM_CSV_MAX_RECORD_BYTES',
      name: 'CsvStringifyError',
      record: 1,
    }),
  )
})

test('csvStringify counts an emitted header as a record for diagnostics', () => {
  expect(() =>
    _([{ first: 'value', second: 'another' }])
      .csvStringify({ header: true, maxRecordBytes: 10 })
      .values(),
  ).toThrowError(expect.objectContaining({ record: 1 }))
})

test.each([
  [[], 'csvStringify options must be an object'],
  [{ separator: '' }, 'csvStringify separator must be a non-empty string'],
  [{ separator: '\r' }, 'csvStringify separator cannot contain a newline'],
  [{ quote: 'ab' }, 'csvStringify quote must be a single character'],
  [{ escape: '' }, 'csvStringify escape must be a single character'],
  [{ lineEnding: '' }, 'csvStringify lineEnding must be a non-empty string'],
  [{ encoding: '' }, 'csvStringify encoding must be a non-empty string'],
  [{ header: 'yes' }, 'csvStringify header must be a boolean or an array'],
  [{ quoted: 1 }, 'csvStringify quoted must be a boolean'],
  [{ quotedEmpty: 1 }, 'csvStringify quotedEmpty must be a boolean'],
  [{ maxColumns: 0 }, 'csvStringify maxColumns must be a positive integer or Infinity'],
  [{ maxRecordBytes: 0 }, 'csvStringify maxRecordBytes must be a positive integer or Infinity'],
])('csvStringify validates options %#', (options, message) => {
  expect(() => _([[1]]).csvStringify(options)).toThrow(message)
})

test('csvStringify round-trips a distinct escape character without duplicating it', () => {
  const rows = [['a"b\\c', 'a\\"b', 42]]
  const serialized = _(rows).csvStringify({ escape: '\\', quoted: true }).values().join('')

  expect(_([serialized]).csv({ escape: '\\' }).values()).toEqual([['a"b\\c', 'a\\"b', '42']])
})

test('CSV recognizes distinct escaped quotes and escapes split across chunks', async () => {
  const serialized = _([['a"b\\c']])
    .csvStringify({ escape: '\\', quoted: true })
    .values()
    .join('')
  const chunks = [...Buffer.from(serialized)].map((byte) => Buffer.from([byte]))

  await expect(_(chunks).csv({ escape: '\\' }).toPromise()).resolves.toEqual([['a"b\\c']])
})