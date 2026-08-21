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
  await expect(_(chunks).jsonl().toArray()).resolves.toEqual(
    chunks.length > 2 ? [{ text: '€ 💥' }, { ok: true }] : [{ id: 1 }, { id: 2 }],
  )
})

test('jsonl handles empty lines explicitly and accepts a final record without newline', async () => {
  expect(await _(['\n \t \r\n1\nnull']).jsonl().toArray()).toEqual([1, null])

  await expect(_(['\n1']).jsonl({ skipEmptyLines: false }).toArray()).rejects.toMatchObject({
    code: 'EXSTREAM_JSONL_EMPTY_RECORD',
    column: 1,
    line: 1,
    name: 'JsonParseError',
    record: 1,
  })
})

test('jsonl does not treat non-JSON Unicode whitespace as an empty line', async () => {
  await expect(_(['\u00a0\n']).jsonl().toArray()).rejects.toMatchObject({
    code: 'EXSTREAM_JSON_PARSE',
    record: 1,
  })
})

test('jsonl handles a trailing carriage and a carriage not followed by line feed', async () => {
  expect(await _(['1\r', '2\r', '\n3\r']).jsonl().toArray()).toEqual([1, 2, 3])
})

test('jsonl accepts empty chunks, null options, fragmented limits and Node encodings', async () => {
  expect(
    await _(['', Buffer.alloc(0), '1'])
      .jsonl(null)
      .toArray(),
  ).toEqual([1])
  expect(await _(['12', '34\n']).jsonl({ maxRecordBytes: 4 }).toArray()).toEqual([1234])
  expect(
    await _([Buffer.from('{"id":1}\n', 'utf16le')])
      .jsonl({ encoding: 'utf16le' })
      .toArray(),
  ).toEqual([{ id: 1 }])
})

test('jsonl counts fragmented UTF-8 surrogate pairs without double-counting replacements', async () => {
  expect(await _(['"\ud83d', '\udca5"\n']).jsonl({ maxRecordBytes: 6 }).toArray()).toEqual(['💥'])
  await expect(
    _(['"\ud83d', '\udca5"\n']).jsonl({ maxRecordBytes: 5 }).toArray(),
  ).rejects.toMatchObject({ code: 'EXSTREAM_JSONL_MAX_RECORD_BYTES' })
})

test('jsonl validates surrogate escapes without giving up its ordinary JSON.parse fast path', async () => {
  expect(await _(['"\\uD83D\\uDCA5"\n"💥"\n']).jsonl().toArray()).toEqual(['💥', '💥'])
  await expect(_(['"\\uD800"\n']).jsonl().toArray()).rejects.toThrow(
    'Unpaired high surrogate in JSON string',
  )
  await expect(_(['"\\uDC00"\n']).jsonl().toArray()).rejects.toThrow(
    'Unpaired low surrogate in JSON string',
  )
})

test('jsonl reports invalid final records without a newline', async () => {
  await expect(_(['{"invalid":']).jsonl().toArray()).rejects.toMatchObject({
    line: 1,
    name: 'JsonParseError',
    record: 1,
  })
})

test('jsonl ignores empty byte and text chunks around completed input', async () => {
  expect(
    await _([Buffer.alloc(0), '', '1\n', '', Buffer.alloc(0)])
      .jsonl()
      .toArray(),
  ).toEqual([1])
})

test('jsonl preserves chunk order when text interrupts an incomplete byte sequence', async () => {
  const chunks = [Buffer.from('"'), Buffer.from([0xe2]), 'x', Buffer.from([0x82, 0xac]), '"\n']

  expect(await _(chunks).jsonl().toArray()).toEqual(['�x��'])
})

test('jsonl resets finite byte accounting across skipped empty records', async () => {
  expect(await _(['\n1\n\r\n2\n']).jsonl({ maxRecordBytes: 1 }).toArray()).toEqual([1, 2])
})

test('jsonl works in a reusable pipeline and accepts null options', async () => {
  expect(await _(['1\n2\n']).through(_.pipeline().jsonl()).toArray()).toEqual([1, 2])
  expect(await _(['3\n']).jsonl(null).toArray()).toEqual([3])
})

test('jsonl applies a reviver after incremental validation', async () => {
  const values = await _(['{"date":"2026-08-13"}\n'])
    .jsonl({ reviver: (key, value) => (key === 'date' ? new Date(`${value}T00:00:00Z`) : value) })
    .toArray()

  expect(values[0].date).toEqual(new Date('2026-08-13T00:00:00Z'))
})

test('jsonl combines depth validation with reviver transformation', async () => {
  const values = await _(['{"amount":"2"}\n'])
    .jsonl({
      maxDepth: 1,
      reviver: (key, value) => (key === 'amount' ? Number(value) : value),
    })
    .toArray()

  expect(values).toEqual([{ amount: 2 }])
})

test('jsonl reviver mode preserves located parser errors for invalid input', async () => {
  const result = _(['{"first":1}\n{"bad":}\n'])
    .jsonl({ reviver: (_key, value) => value })
    .toArray()

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
      .toArray(),
  ).rejects.toThrow('Unpaired high surrogate in JSON string')
})

test('jsonl reports exact record locations and configured limits', async () => {
  await expect(_(['{"ok":1}\n{"bad":}\n']).jsonl().toArray()).rejects.toMatchObject({
    code: 'EXSTREAM_JSON_PARSE',
    line: 2,
    name: 'JsonParseError',
    record: 2,
  })

  await expect(
    _(['{"nested":{"too":"deep"}}\n']).jsonl({ maxDepth: 1 }).toArray(),
  ).rejects.toMatchObject({ code: 'EXSTREAM_JSON_MAX_DEPTH', record: 1 })

  await expect(
    _(['{"value":"€"}\n']).jsonl({ maxRecordBytes: 12 }).toArray(),
  ).rejects.toMatchObject({ code: 'EXSTREAM_JSONL_MAX_RECORD_BYTES', record: 1 })

  expect(await _(['1234\n']).jsonl({ maxRecordBytes: 4 }).toArray()).toEqual([1234])
})

test('jsonl keeps global offsets when records and delimiters span chunks', async () => {
  const result = _(['{"first":', '1}\r', '\n{"second":', '}']).jsonl().toArray()

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

test('jsonlStringify emits one compact JSON value per line and round-trips', async () => {
  const input = [{ id: 1 }, ['€', true], null]
  const serialized = (await _(input).jsonlStringify().toArray()).join('')

  expect(serialized).toBe('{"id":1}\n["€",true]\nnull\n')
  expect(await _(byteChunks(serialized)).jsonl().toArray()).toEqual(input)
})

test('jsonlStringify works in a reusable pipeline and accepts null options', async () => {
  expect(await _([1, 2]).through(_.pipeline().jsonlStringify()).toArray()).toEqual(['1\n', '2\n'])
  expect(await _([3]).jsonlStringify(null).toArray()).toEqual(['3\n'])
})

test('jsonlStringify supports line endings, replacer and byte output encodings', async () => {
  const serialized = (
    await _([{ visible: 1, secret: 2 }])
      .jsonlStringify({ lineEnding: '\r\n', replacer: ['visible'] })
      .toArray()
  ).join('')
  expect(serialized).toBe('{"visible":1}\r\n')

  const utf16 = (
    await _([{ id: 1 }])
      .jsonlStringify({ encoding: 'utf16le' })
      .toArray()
  )[0]
  expect(Buffer.isBuffer(utf16)).toBe(true)
  expect(utf16.toString('utf16le')).toBe('{"id":1}\n')
})

test('jsonlStringify rejects unsupported values and oversized output records', async () => {
  await expect(
    _([BigInt(1)])
      .jsonlStringify()
      .toArray(),
  ).rejects.toMatchObject({
    name: 'JsonStringifyError',
    record: 1,
  })
  await expect(
    _([void 0])
      .jsonlStringify()
      .toArray(),
  ).rejects.toThrow('JSON value is not serializable at record 1')
  await expect(
    _([{ value: '€' }])
      .jsonlStringify({ maxRecordBytes: 12 })
      .toArray(),
  ).rejects.toMatchObject({ code: 'EXSTREAM_JSONL_MAX_RECORD_BYTES', record: 1 })
})

test('JSONL format operators preserve recoverable source errors', async () => {
  const reason = Error('upstream JSONL failure')
  const seen = []
  const source = _([reason, '{"id":1}\n'])
  await expect(
    source
      .jsonl()
      .errors((error) => seen.push(error))
      .toArray(),
  ).resolves.toEqual([{ id: 1 }])
  expect(seen).toEqual([reason])

  const outputSeen = []
  const output = _([reason, { id: 1 }])
  await expect(
    output
      .jsonlStringify()
      .errors((error) => outputSeen.push(error))
      .toArray(),
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