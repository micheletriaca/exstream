const _ = require('../src/index.js')

const chunk = (text, size) =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
    text.slice(index * size, index * size + size),
  )

test.each([1, 2, 7, 4096])('json parses a complete root across %i-character chunks', (size) => {
  const value = {
    array: [1, true, null, -12.5e2],
    escaped: 'quote: " slash: \\ newline:\n euro: €',
    object: { a: 1, b: 2 },
  }
  const text = JSON.stringify(value)

  expect(_(chunk(text, size)).json().values()).toEqual([value])
})

test('json streams matching values from nested wildcards without emitting containers', () => {
  const document = {
    ignored: { huge: Array.from({ length: 100 }, (_, index) => index) },
    groups: [{ items: [{ id: 1 }, { id: 2 }] }, { items: [{ id: 3 }] }],
  }
  const output = _(chunk(JSON.stringify(document), 1))
    .json({ path: '$.groups[*].items[*]' })
    .values()

  expect(output).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
})

test('json supports property and array-index selectors', () => {
  const document = JSON.stringify({ 'data.items': [{ id: 1 }, { id: 2 }] })

  expect(_([document]).json({ path: "$['data.items'][1]" }).values()).toEqual([{ id: 2 }])
  expect(_(['[1,2,3]']).json({ path: '$[0]' }).values()).toEqual([1])
  expect(_(['{"first":1,"second":2}']).json({ path: '$[*]' }).values()).toEqual([1, 2])
  expect(_(['{"missing":true}']).json({ path: '$.items[*]' }).values()).toEqual([])
})

test('json handles selected and discarded primitive values', () => {
  const input = JSON.stringify({
    discarded: ['text', -12.5e2, true, false, null],
    selected: ['text', -12.5e2, true, false, null],
  })

  expect(_([input]).json({ path: '$.selected[*]' }).values()).toEqual([
    'text',
    -1250,
    true,
    false,
    null,
  ])
})

test('json accepts empty chunks, null options, exact limits and Node encodings', () => {
  expect(
    _(['', Buffer.alloc(0), '"€"'])
      .json(null)
      .values(),
  ).toEqual(['€'])
  expect(_(['"€"']).json({ maxValueBytes: 5 }).values()).toEqual(['€'])
  expect(
    _([Buffer.from('{"id":1}', 'utf16le')])
      .json({ encoding: 'utf16le' })
      .values(),
  ).toEqual([{ id: 1 }])
})

test('json preserves chunk order when text interrupts an incomplete byte sequence', () => {
  const chunks = [
    Buffer.from('["'),
    Buffer.from([0xe2]),
    'x',
    Buffer.from([0x82, 0xac]),
    Buffer.from('"]'),
  ]

  expect(_(chunks).json().values()).toEqual([['�x��']])
})

test('json works as a curried standalone operator', () => {
  const parseRows = _.json({ path: '$.rows[*]' })
  expect(_(['{"rows":[1,2]}']).through(parseRows).values()).toEqual([1, 2])
  expect(_(['1']).through(_.json()).values()).toEqual([1])
  expect(_.json(null, _(['2'])).values()).toEqual([2])
})

test('json validates the entire document after the last selected value', async () => {
  const result = _(['{"items":[1,2],"tail":}']).json({ path: '$.items[*]' }).toPromise()

  await expect(result).rejects.toMatchObject({ name: 'JsonParseError' })
})

test('json emits a selected value before the complete document arrives', async () => {
  let release
  let secondChunkRequested = false
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const source = async function* () {
    yield '{"items":[{"id":1},'
    await gate
    secondChunkRequested = true
    yield '{"id":2}],"tail":"still arriving"}'
  }
  const selected = _(source()).json({ path: '$.items[*]' })
  const first = selected.pull()

  await expect(first).resolves.toEqual({ id: 1 })
  expect(secondChunkRequested).toBe(false)

  const rest = selected.toPromise()
  release()
  await expect(rest).resolves.toEqual([{ id: 2 }])
})

test('json keeps only the currently selected value while scanning ignored data', () => {
  const document = `{"ignored":${JSON.stringify('x'.repeat(256 * 1024))},"rows":[1,2]}`
  expect(_(chunk(document, 17)).json({ path: '$.rows[*]', maxValueBytes: 1 }).values()).toEqual([
    1, 2,
  ])
})

test.each([
  ['{"a":}', 'Expected a JSON value'],
  ['[1,]', 'Expected a JSON value'],
  ['{"a":1', 'Unexpected end of JSON input'],
  ['"bad\\x"', 'Invalid escape in JSON string'],
  ['01', 'Invalid JSON number'],
  ['true false', 'Unexpected content after JSON value'],
  ['', 'Expected a JSON value'],
  ['   \r\n ', 'Expected a JSON value'],
  ['tru', 'Unexpected end of JSON literal'],
  ['falsx', 'Invalid JSON literal'],
  ['"unterminated', 'Unexpected end of JSON string'],
  ['"bad\\u12xz"', 'Invalid Unicode escape in JSON string'],
  ['"\\uD800"', 'Unpaired high surrogate in JSON string'],
  ['"\\uDC00"', 'Unpaired low surrogate in JSON string'],
  ['"\\uD800x"', 'Unpaired high surrogate in JSON string'],
  ['"line\nfeed"', 'Control character in JSON string'],
  ['{"a" 1}', 'Expected : after JSON object property'],
  ['{a:1}', 'Expected a JSON object property'],
  ['{"a":1 "b":2}', 'Expected , or } after JSON object value'],
  ['{"a":1,}', 'Expected a JSON object property'],
  ['[1 2]', 'Expected , or ] after JSON array value'],
])('json rejects invalid input %s', async (input, message) => {
  await expect(_(chunk(input, 1)).json().toPromise()).rejects.toThrow(message)
})

test('json accepts surrogate pairs in escaped, literal, and chunked forms', () => {
  expect(_(['"\\uD83D', '\\uDCA5"']).json().values()).toEqual(['💥'])
  expect(_(['"\ud83d', '\udca5"']).json().values()).toEqual(['💥'])
})

test('json rejects unpaired literal surrogate code units', async () => {
  await expect(_(['"\ud83d"']).json().toPromise()).rejects.toThrow(
    'Unpaired high surrogate in JSON string',
  )
  await expect(_(['"\udca5"']).json().toPromise()).rejects.toThrow(
    'Unpaired low surrogate in JSON string',
  )
})

test('json parses every JSON escape, empty containers, and protected object keys', () => {
  const input =
    '{"emptyObject":{},"emptyArray":[],"escapes":"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u20ac","__proto__":{"safe":true}}'
  const value = _([input]).json().values()[0]

  expect(value.emptyObject).toEqual({})
  expect(value.emptyArray).toEqual([])
  expect(value.escapes).toBe('"\\/\b\f\n\r\t€')
  expect(Object.hasOwn(value, '__proto__')).toBe(true)
  expect(value.__proto__).toEqual({ safe: true })
})

test('json reports line, column and offset after mixed whitespace', async () => {
  await expect(_(['{\r\n  "a": 1,\n  "b": }']).json().toPromise()).rejects.toMatchObject({
    column: 8,
    line: 3,
    offset: 20,
  })
})

test('json enforces depth and selected-value byte limits', async () => {
  await expect(_(['{"a":{"b":1}}']).json({ maxDepth: 1 }).toPromise()).rejects.toMatchObject({
    code: 'EXSTREAM_JSON_MAX_DEPTH',
  })
  await expect(
    _(['{"items":["€"]}']).json({ path: '$.items[*]', maxValueBytes: 4 }).toPromise(),
  ).rejects.toMatchObject({ code: 'EXSTREAM_JSON_MAX_VALUE_BYTES' })
  expect(
    _(['{"ignored":"this may be large","items":[1]}'])
      .json({ path: '$.items[*]', maxValueBytes: 1 })
      .values(),
  ).toEqual([1])
  expect(
    _(['{"ignored":"large","other":1}']).json({ path: '$.missing', maxValueBytes: 1 }).values(),
  ).toEqual([])
})

test.each([
  [[], 'json options must be an object'],
  [{ encoding: '' }, 'json encoding must be a non-empty string'],
  [{ maxDepth: 0 }, 'json maxDepth must be a positive integer or Infinity'],
  [{ maxValueBytes: 0 }, 'json maxValueBytes must be a positive integer or Infinity'],
  [{ maxDepth: Symbol('invalid') }, 'json maxDepth must be a positive integer or Infinity'],
  [{ path: '$..items' }, 'Unsupported JSON path'],
])('json validates options %#', (options, message) => {
  expect(() => _(['null']).json(options)).toThrow(message)
})

test('jsonStringify emits a streaming JSON array by default', async () => {
  const chunks = await _([{ id: 1 }, { id: 2 }, null])
    .jsonStringify()
    .toPromise()

  expect(chunks.length).toBeGreaterThan(1)
  expect(JSON.parse(chunks.join(''))).toEqual([{ id: 1 }, { id: 2 }, null])
})

test('jsonStringify builds nested envelopes and appends final properties at stream close', async () => {
  let finalized = false
  const chunks = await _([{ amount: 2 }, { amount: 3 }])
    .jsonStringify({
      finalize: async ({ bytesWritten, count, signal }) => {
        finalized = true
        expect(bytesWritten).toBeGreaterThan(0)
        expect(count).toBe(2)
        expect(signal.aborted).toBe(false)
        return { count, generated: true }
      },
      path: '$.data.records[*]',
      properties: { version: 1 },
    })
    .toPromise()

  expect(finalized).toBe(true)
  expect(JSON.parse(chunks.join(''))).toEqual({
    version: 1,
    data: { records: [{ amount: 2 }, { amount: 3 }] },
    count: 2,
    generated: true,
  })
})

test('jsonStringify exposes branch cancellation to an asynchronous finalizer', async () => {
  const reason = Error('finalizer cancelled')
  let entered
  const finalizerStarted = new Promise((resolve) => {
    entered = resolve
  })
  let finalizerSignal
  const output = _([1]).jsonStringify({
    path: '$.rows[*]',
    finalize: ({ signal }) => {
      finalizerSignal = signal
      entered()
      return new Promise((_resolve, reject) => {
        const cancel = () => reject(signal.reason)
        if (signal.aborted) cancel()
        else signal.addEventListener('abort', cancel, { once: true })
      })
    },
  })
  const pending = output.toPromise()

  await finalizerStarted
  output.abort(reason)

  await expect(pending).rejects.toBe(reason)
  expect(finalizerSignal.aborted).toBe(true)
  expect(finalizerSignal.reason).toBe(reason)
})

test('jsonStringify supports replacers, quoted envelope paths, and standalone currying', async () => {
  const stringifyRows = _.jsonStringify({
    path: "$['data.items'][*]",
    properties: { version: 1 },
    replacer: ['visible'],
  })
  const chunks = await _([{ visible: 1, hidden: 2 }])
    .through(stringifyRows)
    .toPromise()

  expect(JSON.parse(chunks.join(''))).toEqual({ version: 1, 'data.items': [{ visible: 1 }] })
  expect((await _([1]).through(_.jsonStringify()).toPromise()).join('')).toBe('[1]')
  expect((await _.jsonStringify(null, _([2])).toPromise()).join('')).toBe('[2]')
})

test('jsonStringify closes empty arrays and envelopes', async () => {
  await expect(_([]).jsonStringify().toPromise()).resolves.toEqual(['[', ']'])
  const chunks = await _([])
    .jsonStringify({ path: '$.rows[*]', finalize: ({ count }) => ({ count }) })
    .toPromise()
  expect(JSON.parse(chunks.join(''))).toEqual({ rows: [], count: 0 })
})

test('jsonStringify rejects collisions, unsupported values, and invalid finalizers', async () => {
  expect(() =>
    _([1]).jsonStringify({ path: '$.rows[*]', properties: { rows: 'collision' } }),
  ).toThrow('collide with path property')

  await expect(
    _([BigInt(1)])
      .jsonStringify()
      .toPromise(),
  ).rejects.toMatchObject({
    name: 'JsonStringifyError',
    record: 1,
  })
  await expect(
    _([1])
      .jsonStringify({ path: '$.rows[*]', finalize: () => ({ rows: 1 }) })
      .toPromise(),
  ).rejects.toThrow('final property collides')
  await expect(
    _([1])
      .jsonStringify({ path: '$.rows[*]', finalize: () => null })
      .toPromise(),
  ).rejects.toThrow('finalize must return an object')
  await expect(
    _([1])
      .jsonStringify({ path: '$.rows[*]', finalize: () => [] })
      .toPromise(),
  ).rejects.toThrow('finalize must return an object')
  await expect(
    _([1])
      .jsonStringify({ path: '$.rows[*]', finalize: () => undefined })
      .toPromise(),
  ).rejects.toThrow('finalize must return an object')
  await expect(
    _([1])
      .jsonStringify({
        path: '$.rows[*]',
        finalize: () => {
          throw Error('application finalizer failed')
        },
      })
      .toPromise(),
  ).rejects.toThrow('Cannot finalize JSON: application finalizer failed')
  await expect(
    _([1])
      .jsonStringify({ path: '$.rows[*]', finalize: () => Promise.reject('string failure') })
      .toPromise(),
  ).rejects.toThrow('Cannot finalize JSON: string failure')

  const cyclic = {}
  cyclic.self = cyclic
  await expect(_([cyclic]).jsonStringify().toPromise()).rejects.toThrow('Cannot stringify JSON')
  await expect(
    _([void 0])
      .jsonStringify()
      .toPromise(),
  ).rejects.toThrow('JSON value is not serializable at record 1')
  expect(() => _([1]).jsonStringify({ properties: { invalid: void 0 } })).toThrow(
    'properties and finalize require an envelope path',
  )
})

test.each([
  [[], 'jsonStringify options must be an object'],
  [{ encoding: 1 }, 'jsonStringify encoding must be a non-empty string'],
  [{ encoding: '' }, 'jsonStringify encoding must be a non-empty string'],
  [{ maxValueBytes: 0 }, 'jsonStringify maxValueBytes must be a positive integer or Infinity'],
  [{ properties: null }, 'jsonStringify properties must be an object'],
  [{ properties: [] }, 'jsonStringify properties must be an object'],
  [{ properties: 'invalid' }, 'jsonStringify properties must be an object'],
  [{ finalize: true }, 'jsonStringify finalize must be a function'],
  [{ replacer: true }, 'jsonStringify replacer must be a function or an array'],
  [{ path: '$[*]', finalize: () => ({}) }, 'properties and finalize require an envelope path'],
  [{ path: '$.items' }, 'must end in [*]'],
])('jsonStringify validates options %#', (options, message) => {
  expect(() => _([1]).jsonStringify(options)).toThrow(message)
})

test('jsonStringify enforces serialized value limits and supports encoded byte chunks', async () => {
  await expect(_(['€']).jsonStringify({ maxValueBytes: 4 }).toPromise()).rejects.toMatchObject({
    code: 'EXSTREAM_JSON_MAX_VALUE_BYTES',
    record: 1,
  })

  const chunks = await _([1, 2]).jsonStringify({ encoding: 'utf16le' }).toPromise()
  expect(Buffer.concat(chunks).toString('utf16le')).toBe('[1,2]')

  await expect(_([1]).jsonStringify({ maxValueBytes: 1 }).toPromise()).resolves.toEqual(['[1', ']'])
  await expect(_([1]).jsonStringify({ encoding: 'utf-8' }).toPromise()).resolves.toEqual([
    '[1',
    ']',
  ])
})

test('JSON format operators preserve recoverable source errors', async () => {
  const reason = Error('upstream JSON failure')
  const source = _((write) => {
    write(reason)
    write('1')
    write(_.nil)
  })
  const seen = []
  await expect(
    source
      .json()
      .errors((error) => seen.push(error))
      .toPromise(),
  ).resolves.toEqual([1])
  expect(seen).toEqual([reason])

  const stringifySeen = []
  const stringifySource = _((write) => {
    write(reason)
    write(1)
    write(_.nil)
  })
  await expect(
    stringifySource
      .jsonStringify()
      .errors((error) => stringifySeen.push(error))
      .toPromise(),
  ).resolves.toEqual(['[1', ']'])
  expect(stringifySeen).toEqual([reason])
})