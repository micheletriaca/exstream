const { parse } = require('csv-parse/sync')
const _ = require('../src/index.js')

test('csvStringify quotes CR and LF independently from the configured line ending', async () => {
  const rows = [
    ['line\nfeed', 'carriage\rreturn', 'both\r\ncharacters'],
    ['plain', 'value', 'row'],
  ]
  const serialized = (await _(rows).csvStringify({ lineEnding: '\r\n' }).toArray()).join('')

  expect(parse(serialized, { record_delimiter: '\r\n' })).toEqual(rows)
})

test('csvStringify maxColumns reports output record and column', async () => {
  await expect(
    _([[1, 2, 3]])
      .csvStringify({ maxColumns: 2 })
      .toArray(),
  ).rejects.toMatchObject({
    code: 'EXSTREAM_CSV_MAX_COLUMNS',
    column: 3,
    name: 'CsvStringifyError',
    record: 1,
  })
})

test('csvStringify maxRecordBytes includes delimiters and the line ending', async () => {
  await expect(
    _([['123', '45']])
      .csvStringify({ maxRecordBytes: 6 })
      .toArray(),
  ).rejects.toMatchObject({
    code: 'EXSTREAM_CSV_MAX_RECORD_BYTES',
    name: 'CsvStringifyError',
    record: 1,
  })
})

test('csvStringify accepts a record exactly at maxRecordBytes', async () => {
  await expect(
    _([['123', '45']])
      .csvStringify({ maxRecordBytes: 7 })
      .toArray(),
  ).resolves.toEqual(['123,45\n'])
})

test('csvStringify counts an emitted header as a record for diagnostics', async () => {
  await expect(
    _([{ first: 'value', second: 'another' }])
      .csvStringify({ header: true, maxRecordBytes: 10 })
      .toArray(),
  ).rejects.toMatchObject({ record: 1 })
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

test('csvStringify round-trips a distinct escape character without duplicating it', async () => {
  const rows = [['a"b\\c', 'a\\"b', 42]]
  const serialized = (await _(rows).csvStringify({ escape: '\\', quoted: true }).toArray()).join('')

  expect(await _([serialized]).csv({ escape: '\\' }).toArray()).toEqual([['a"b\\c', 'a\\"b', '42']])
})

test('CSV recognizes distinct escaped quotes and escapes split across chunks', async () => {
  const serialized = (
    await _([['a"b\\c']])
      .csvStringify({ escape: '\\', quoted: true })
      .toArray()
  ).join('')
  const chunks = [...Buffer.from(serialized)].map((byte) => Buffer.from([byte]))

  await expect(_(chunks).csv({ escape: '\\' }).toArray()).resolves.toEqual([['a"b\\c']])
})