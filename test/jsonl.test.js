const _ = require('../src/index.js')

const byteChunks = (text, size = 1) => {
  const bytes = Buffer.from(text)
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, index) =>
    bytes.subarray(index * size, index * size + size),
  )
}

test.each([
  [['{"id":1}\n{"id":2}\n']],
  [['{"id":1}\r', '\n{"id":2}']],
  [byteChunks('{"text":"€ 💥"}\n{"ok":true}', 1)],
])('jsonl parses records across arbitrary text and UTF-8 chunk boundaries', async (chunks) => {
  await expect(_(chunks).jsonl().toPromise()).resolves.toEqual(
    chunks.length > 2 ? [{ text: '€ 💥' }, { ok: true }] : [{ id: 1 }, { id: 2 }],
  )
})

test('jsonl handles empty lines explicitly and accepts a final record without newline', async () => {
  expect(_(['\n \t \r\n1\nnull']).jsonl().values()).toEqual([1, null])

  await expect(_(['\n1']).jsonl({ skipEmptyLines: false }).toPromise()).rejects.toMatchObject({
    code: 'EXSTREAM_JSONL_EMPTY_RECORD',
    column: 1,
    line: 1,
    name: 'JsonParseError',
    record: 1,
  })
})

test('jsonl does not treat non-JSON Unicode whitespace as an empty line', async () => {
  await expect(_(['\u00a0\n']).jsonl().toPromise()).rejects.toMatchObject({
    code: 'EXSTREAM_JSON_PARSE',
    record: 1,
  })
})

test('jsonl handles a trailing carriage and a carriage not followed by line feed', () => {
  expect(_(['1\r', '2\r', '\n3\r']).jsonl().values()).toEqual([1, 2, 3])
})

test('jsonl accepts empty chunks, null options, fragmented limits and Node encodings', () => {
  expect(
    _(['', Buffer.alloc(0), '1'])
      .jsonl(null)
      .values(),
  ).toEqual([1])
  expect(_(['12', '34\n']).jsonl({ maxRecordBytes: 4 }).values()).toEqual([1234])
  expect(
    _([Buffer.from('{"id":1}\n', 'utf16le')])
      .jsonl({ encoding: 'utf16le' })
      .values(),
  ).toEqual([{ id: 1 }])
})

test('jsonl counts fragmented UTF-8 surrogate pairs without double-counting replacements', () => {
  expect(_(['"\ud83d', '\udca5"\n']).jsonl({ maxRecordBytes: 6 }).values()).toEqual(['💥'])
  expect(() => _(['"\ud83d', '\udca5"\n']).jsonl({ maxRecordBytes: 5 }).values()).toThrowError(
    expect.objectContaining({ code: 'EXSTREAM_JSONL_MAX_RECORD_BYTES' }),
  )
})

test('jsonl validates surrogate escapes without giving up its ordinary JSON.parse fast path', async () => {
  expect(_(['"\\uD83D\\uDCA5"\n"💥"\n']).jsonl().values()).toEqual(['💥', '💥'])
  await expect(_(['"\\uD800"\n']).jsonl().toPromise()).rejects.toThrow(
    'Unpaired high surrogate in JSON string',
  )
  await expect(_(['"\\uDC00"\n']).jsonl().toPromise()).rejects.toThrow(
    'Unpaired low surrogate in JSON string',
  )
})

test('jsonl reports invalid final records without a newline', async () => {
  await expect(_(['{"invalid":']).jsonl().toPromise()).rejects.toMatchObject({
    line: 1,
    name: 'JsonParseError',
    record: 1,
  })
})

test('jsonl ignores empty byte and text chunks around completed input', () => {
  expect(
    _([Buffer.alloc(0), '', '1\n', '', Buffer.alloc(0)])
      .jsonl()
      .values(),
  ).toEqual([1])
})

test('jsonl preserves chunk order when text interrupts an incomplete byte sequence', () => {
  const chunks = [Buffer.from('"'), Buffer.from([0xe2]), 'x', Buffer.from([0x82, 0xac]), '"\n']

  expect(_(chunks).jsonl().values()).toEqual(['�x��'])
})

test('jsonl resets finite byte accounting across skipped empty records', () => {
  expect(_(['\n1\n\r\n2\n']).jsonl({ maxRecordBytes: 1 }).values()).toEqual([1, 2])
})

test('jsonl works as a curried standalone operator', () => {
  expect(_(['1\n2\n']).through(_.jsonl()).values()).toEqual([1, 2])
  expect(_.jsonl(null, _(['3\n'])).values()).toEqual([3])
})

test('jsonl applies a reviver after incremental validation', () => {
  const values = _(['{"date":"2026-08-13"}\n'])
    .jsonl({ reviver: (key, value) => (key === 'date' ? new Date(`${value}T00:00:00Z`) : value) })
    .values()

  expect(values[0].date).toEqual(new Date('2026-08-13T00:00:00Z'))
})

test('jsonl combines depth validation with reviver transformation', () => {
  const values = _(['{"amount":"2"}\n'])
    .jsonl({
      maxDepth: 1,
      reviver: (key, value) => (key === 'amount' ? Number(value) : value),
    })
    .values()

  expect(values).toEqual([{ amount: 2 }])
})

test('jsonl reviver mode preserves located parser errors for invalid input', async () => {
  const result = _(['{"first":1}\n{"bad":}\n'])
    .jsonl({ reviver: (_key, value) => value })
    .toPromise()

  await expect(result).rejects.toMatchObject({
    line: 2,
    name: 'JsonParseError',
    record: 2,
  })
})

test('jsonl reviver mode rejects unpaired surrogate escapes', async () => {
  await expect(
    _(['"\\uD800"\n'])
      .jsonl({ reviver: (_key, value) => value })
      .toPromise(),
  ).rejects.toThrow('Unpaired high surrogate in JSON string')
})

test('jsonl reports exact record locations and configured limits', async () => {
  await expect(_(['{"ok":1}\n{"bad":}\n']).jsonl().toPromise()).rejects.toMatchObject({
    code: 'EXSTREAM_JSON_PARSE',
    line: 2,
    name: 'JsonParseError',
    record: 2,
  })

  await expect(
    _(['{"nested":{"too":"deep"}}\n']).jsonl({ maxDepth: 1 }).toPromise(),
  ).rejects.toMatchObject({ code: 'EXSTREAM_JSON_MAX_DEPTH', record: 1 })

  await expect(
    _(['{"value":"€"}\n']).jsonl({ maxRecordBytes: 12 }).toPromise(),
  ).rejects.toMatchObject({ code: 'EXSTREAM_JSONL_MAX_RECORD_BYTES', record: 1 })

  expect(_(['1234\n']).jsonl({ maxRecordBytes: 4 }).values()).toEqual([1234])
})

test('jsonl keeps global offsets when records and delimiters span chunks', async () => {
  const result = _(['{"first":', '1}\r', '\n{"second":', '}']).jsonl().toPromise()

  await expect(result).rejects.toMatchObject({
    column: 11,
    line: 2,
    offset: 23,
    record: 2,
  })
})

test.each([
  [[], 'jsonl options must be an object'],
  [{ encoding: '' }, 'jsonl encoding must be a non-empty string'],
  [{ skipEmptyLines: 1 }, 'jsonl skipEmptyLines must be a boolean'],
  [{ reviver: true }, 'jsonl reviver must be a function'],
  [{ maxDepth: 0 }, 'jsonl maxDepth must be a positive integer or Infinity'],
  [{ maxRecordBytes: 0 }, 'jsonl maxRecordBytes must be a positive integer or Infinity'],
])('jsonl validates options %#', (options, message) => {
  expect(() => _(['1']).jsonl(options)).toThrow(message)
})

test('jsonlStringify emits one compact JSON value per line and round-trips', () => {
  const input = [{ id: 1 }, ['€', true], null]
  const serialized = _(input).jsonlStringify().values().join('')

  expect(serialized).toBe('{"id":1}\n["€",true]\nnull\n')
  expect(_(byteChunks(serialized)).jsonl().values()).toEqual(input)
})

test('jsonlStringify works as a curried standalone operator and accepts null options', () => {
  expect(_([1, 2]).through(_.jsonlStringify()).values()).toEqual(['1\n', '2\n'])
  expect(_([1, 2]).through(_.jsonlStringify(null)).values()).toEqual(['1\n', '2\n'])
  expect(_.jsonlStringify(null, _([3])).values()).toEqual(['3\n'])
})

test('jsonlStringify supports line endings, replacer and byte output encodings', () => {
  const serialized = _([{ visible: 1, secret: 2 }])
    .jsonlStringify({ lineEnding: '\r\n', replacer: ['visible'] })
    .values()
    .join('')
  expect(serialized).toBe('{"visible":1}\r\n')

  const utf16 = _([{ id: 1 }])
    .jsonlStringify({ encoding: 'utf16le' })
    .values()[0]
  expect(Buffer.isBuffer(utf16)).toBe(true)
  expect(utf16.toString('utf16le')).toBe('{"id":1}\n')
})

test('jsonlStringify rejects unsupported values and oversized output records', async () => {
  await expect(
    _([BigInt(1)])
      .jsonlStringify()
      .toPromise(),
  ).rejects.toMatchObject({
    name: 'JsonStringifyError',
    record: 1,
  })
  await expect(
    _([void 0])
      .jsonlStringify()
      .toPromise(),
  ).rejects.toThrow('JSON value is not serializable at record 1')
  await expect(
    _([{ value: '€' }])
      .jsonlStringify({ maxRecordBytes: 12 })
      .toPromise(),
  ).rejects.toMatchObject({ code: 'EXSTREAM_JSONL_MAX_RECORD_BYTES', record: 1 })
})

test('JSONL format operators preserve recoverable source errors', async () => {
  const reason = Error('upstream JSONL failure')
  const seen = []
  const source = _((write) => {
    write(reason)
    write('{"id":1}\n')
    write(_.nil)
  })
  await expect(
    source
      .jsonl()
      .errors((error) => seen.push(error))
      .toPromise(),
  ).resolves.toEqual([{ id: 1 }])
  expect(seen).toEqual([reason])

  const outputSeen = []
  const output = _((write) => {
    write(reason)
    write({ id: 1 })
    write(_.nil)
  })
  await expect(
    output
      .jsonlStringify()
      .errors((error) => outputSeen.push(error))
      .toPromise(),
  ).resolves.toEqual(['{"id":1}\n'])
  expect(outputSeen).toEqual([reason])
})

test.each([
  [[], 'jsonlStringify options must be an object'],
  [{ encoding: 1 }, 'jsonlStringify encoding must be a non-empty string'],
  [{ encoding: '' }, 'jsonlStringify encoding must be a non-empty string'],
  [{ lineEnding: 1 }, 'jsonlStringify lineEnding must be a non-empty string'],
  [{ lineEnding: '' }, 'jsonlStringify lineEnding must be a non-empty string'],
  [{ replacer: true }, 'jsonlStringify replacer must be a function or an array'],
  [{ maxRecordBytes: 0 }, 'jsonlStringify maxRecordBytes must be a positive integer or Infinity'],
])('jsonlStringify validates options %#', (options, message) => {
  expect(() => _([1]).jsonlStringify(options)).toThrow(message)
})