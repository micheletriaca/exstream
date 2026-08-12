const _ = require('../src/index.js')

test('CSV maxRecordBytes stops the parser with a located error', async () => {
  const result = _(['a,b\n12345,2\n']).csv({ maxRecordBytes: 5 }).toPromise()

  await expect(result).rejects.toMatchObject({
    code: 'EXSTREAM_CSV_MAX_RECORD_BYTES',
    column: 6,
    line: 2,
    name: 'CsvParseError',
    record: 2,
  })
  await expect(result).rejects.toThrow('maxRecordBytes (5) at line 2, column 6')
})

test('CSV maxColumns reports the field and physical location', async () => {
  const result = _(['a,b,c\n']).csv({ maxColumns: 2 }).toPromise()

  await expect(result).rejects.toMatchObject({
    code: 'EXSTREAM_CSV_MAX_COLUMNS',
    column: 6,
    line: 1,
    name: 'CsvParseError',
    record: 1,
  })
})

test('CSV reports an unterminated quote at end of input', async () => {
  const result = _(['id,value\n1,"first\nsecond']).csv({ header: true }).toPromise()

  await expect(result).rejects.toMatchObject({
    code: 'EXSTREAM_CSV_UNTERMINATED_QUOTE',
    line: 3,
    name: 'CsvParseError',
    record: 2,
  })
  await expect(result).rejects.toThrow('Unterminated quoted CSV field')
})

test('CSV reports invalid characters after a closing quote', async () => {
  const result = _(['"value"unexpected,next\n']).csv().toPromise()

  await expect(result).rejects.toMatchObject({
    code: 'EXSTREAM_CSV_PARSE',
    column: 8,
    line: 1,
    name: 'CsvParseError',
  })
  await expect(result).rejects.toThrow('Unexpected character after closing CSV quote')
})

test('CSV preserves its historical empty-line default and offers lossless empty records', () => {
  const input = 'a\n\n""\nb\n'

  expect(_([input]).csv().values()).toEqual([['a'], [''], ['b']])
  expect(_([input]).csv({ skipEmptyLines: false }).values()).toEqual([['a'], [''], [''], ['b']])
})

test('CSV parses UTF-16LE byte streams incrementally in Node', async () => {
  const bytes = Buffer.from('id,name\r\n1,€\r\n', 'utf16le')
  const chunks = Array.from({ length: Math.ceil(bytes.length / 3) }, (_, index) =>
    bytes.subarray(index * 3, index * 3 + 3),
  )

  await expect(_(chunks).csv({ encoding: 'utf16le', header: true }).toPromise()).resolves.toEqual([
    { id: '1', name: '€' },
  ])
})

test.each([
  [[], 'csv options must be an object'],
  [{ separator: '' }, 'csv separator must be a non-empty string'],
  [{ separator: '\n' }, 'csv separator cannot contain a newline'],
  [{ quote: 'ab' }, 'csv quote must be a single character'],
  [{ escape: '' }, 'csv escape must be a single character'],
  [{ encoding: '' }, 'csv encoding must be a non-empty string'],
  [{ fastMode: 1 }, 'csv fastMode must be a boolean'],
  [{ skipEmptyLines: 1 }, 'csv skipEmptyLines must be a boolean'],
  [{ header: 'yes' }, 'csv header must be a boolean, an array, or a function'],
  [{ maxColumns: 0 }, 'csv maxColumns must be a positive integer or Infinity'],
  [{ maxRecordBytes: -1 }, 'csv maxRecordBytes must be a positive integer or Infinity'],
])('CSV validates parser options %#', (options, message) => {
  expect(() => _(['a']).csv(options)).toThrow(message)
})

test('CSV validates the result of a header function with location', async () => {
  const result = _(['a,b\n1,2\n'])
    .csv({ header: () => 'invalid' })
    .toPromise()

  await expect(result).rejects.toBeInstanceOf(_.CsvParseError)
  await expect(result).rejects.toThrow('CSV header function must return an array at line 1')
})

test('CSV enforces limits while parsing quoted and fragmented records', async () => {
  const tooWide = _(['"a",', '"b",', '"c"\n']).csv({ maxColumns: 2 }).toPromise()
  await expect(tooWide).rejects.toMatchObject({
    code: 'EXSTREAM_CSV_MAX_COLUMNS',
    line: 1,
    record: 1,
  })

  const tooLarge = _(['"12', '34', '56"\n']).csv({ maxRecordBytes: 5 }).toPromise()
  await expect(tooLarge).rejects.toMatchObject({
    code: 'EXSTREAM_CSV_MAX_RECORD_BYTES',
    line: 1,
    record: 1,
  })
})

test('CSV handles lone CR and CRLF delimiters incrementally across chunks', async () => {
  const values = await _(['a,b\r\n1,2\r3,4\n5,6\r7,8\r', '\n9,10\r11,12', '\r']).csv().toPromise()

  expect(values).toEqual([
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
    ['5', '6'],
    ['7', '8'],
    ['9', '10'],
    ['11', '12'],
  ])
})

test('CSV supports valid header callbacks, injected headers, and null options', () => {
  expect(
    _(['a,b\n1,2\n'])
      .csv({ header: (row) => row.map((cell) => `x-${cell}`) })
      .values(),
  ).toEqual([{ 'x-a': '1', 'x-b': '2' }])
  expect(
    _(['1,2\n'])
      .csv({ header: ['a', 'b'] })
      .values(),
  ).toEqual([{ a: '1', b: '2' }])
  expect(_(['1,2\n']).csv(null).values()).toEqual([['1', '2']])
  expect(_(['a,b\n1,2\n']).csv({ header: [] }).values()).toEqual([{ a: '1', b: '2' }])
})

test('CSV rejects non-coercible limits', () => {
  expect(() => _(['a']).csv({ maxColumns: Symbol('invalid') })).toThrow(
    'csv maxColumns must be a positive integer or Infinity',
  )
})

test('CSV accepts records exactly within byte and column limits on both parser paths', () => {
  expect(_(['a,b\n']).csv({ maxColumns: 2, maxRecordBytes: 3 }).values()).toEqual([['a', 'b']])
  expect(_(['"a","b"\n']).csv({ maxColumns: 2, maxRecordBytes: 7 }).values()).toEqual([['a', 'b']])
})

test('CSV rejects a quote that starts inside an unquoted field', async () => {
  const result = _(['ab"c",d\n']).csv().toPromise()

  await expect(result).rejects.toThrow('Unexpected quote in unquoted CSV field')
})

test('CSV byte limits locate a multibyte UTF-8 value', async () => {
  expect(_(['€\n']).csv({ maxRecordBytes: 3 }).values()).toEqual([['€']])

  await expect(_(['€\n']).csv({ maxRecordBytes: 2 }).toPromise()).rejects.toMatchObject({
    code: 'EXSTREAM_CSV_MAX_RECORD_BYTES',
    column: 1,
  })
})

test('CSV ignores empty chunks and propagates source record errors', async () => {
  expect(
    _([Buffer.alloc(0), Buffer.from('a,b\n')])
      .csv()
      .values(),
  ).toEqual([['a', 'b']])

  const reason = Error('upstream CSV failure')
  const seen = []
  const source = _((write) => {
    write(reason)
    write(_.nil)
  })
  await expect(
    source
      .csv()
      .errors((error) => seen.push(error))
      .toPromise(),
  ).resolves.toEqual([])
  expect(seen).toEqual([reason])
})