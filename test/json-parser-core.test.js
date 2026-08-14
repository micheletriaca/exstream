const { asLimit, createJsonParser, JsonParseError } = require('../src/json-parser.js')
const { parseJsonPath } = require('../src/json-path.js')

const parse = (parts, options = {}) => {
  const values = []
  const parser = createJsonParser({ onValue: (value) => values.push(value), ...options })
  for (const part of parts) parser.write(part)
  parser.end()
  return { parser, values }
}

test('JSON parser core accepts defaults, pre-parsed paths, empty writes and repeated ending', () => {
  const root = parse(['', '{"a":', '1}'])
  expect(root.values).toEqual([{ a: 1 }])
  root.parser.end()
  root.parser.write('ignored after end')

  expect(parse(['[1,2]'], { path: parseJsonPath('$[1]') }).values).toEqual([2])
})

test('JSON parser core tracks lone LF, lone CR and CRLF as physical newlines', () => {
  for (const [input, expected] of [
    ['{\n"a":}', { line: 2, column: 5, offset: 6 }],
    ['{\r"a":}', { line: 2, column: 5, offset: 6 }],
    ['{\r\n"a":}', { line: 2, column: 5, offset: 7 }],
  ]) {
    expect(() => parse([input])).toThrowError(expect.objectContaining(expected))
  }
})

test('JSON parser core treats LF after an ordinary character as a new line', () => {
  expect(() => parse(['{ "a": 1,\n"b": }'])).toThrowError(expect.objectContaining({ line: 2 }))
})

test('JSON parser core discards unmatched containers while validating their contents', () => {
  expect(
    parse(['{"discarded":{"nested":[1,"text",false]},"selected":2}'], {
      path: '$.selected',
    }).values,
  ).toEqual([2])
})

test('JSON parser core covers each value-token transition in discarded arrays', () => {
  expect(
    parse(['{"discarded":[{},[],"a\\nb",0,-1,1.2e+3,true,false,null],"selected":7}'], {
      path: '$.selected',
    }).values,
  ).toEqual([7])
})

test('JSON parser core completes numbers on punctuation and literals on their last character', () => {
  expect(parse(['[1', ',true', ',false', ',null', ']']).values).toEqual([[1, true, false, null]])
})

test('JSON parser core enforces exact selected-value limits only', () => {
  expect(parse(['{"selected":"€"}'], { maxValueBytes: 5, path: '$.selected' }).values).toEqual([
    '€',
  ])
  expect(() => parse(['{"selected":"€"}'], { maxValueBytes: 4, path: '$.selected' })).toThrowError(
    expect.objectContaining({ code: 'EXSTREAM_JSON_MAX_VALUE_BYTES' }),
  )
  expect(
    parse(['{"discarded":"a large value","selected":1}'], {
      maxValueBytes: 1,
      path: '$.selected',
    }).values,
  ).toEqual([1])
})

test('JSON parser core enforces selected limits before a large value completes', () => {
  const parser = createJsonParser({
    maxValueBytes: 8,
    onValue: () => {
      throw Error('the oversized value must not be emitted')
    },
  })

  expect(() => parser.write('"12345678')).toThrowError(
    expect.objectContaining({ code: 'EXSTREAM_JSON_MAX_VALUE_BYTES' }),
  )
})

test('JSON parser core counts UTF-8 bytes across surrogate chunk boundaries', () => {
  expect(parse(['"\ud83d', '\udca5"'], { maxValueBytes: 6 }).values).toEqual(['💥'])
  expect(() => parse(['"\ud83d', '\udca5"'], { maxValueBytes: 5 })).toThrowError(
    expect.objectContaining({ code: 'EXSTREAM_JSON_MAX_VALUE_BYTES' }),
  )
})

test('JSON parser core reports optional record metadata only when provided', () => {
  expect(new JsonParseError('bad', { column: 1, line: 1, offset: 0 })).not.toHaveProperty('record')
  expect(new JsonParseError('bad', { column: 1, line: 1, offset: 0, record: 2 })).toHaveProperty(
    'record',
    2,
  )
})

test('JSON limits accept defaults, Infinity and positive integer coercions', () => {
  expect(asLimit(void 0, 'limit')).toBe(Infinity)
  expect(asLimit(Infinity, 'limit')).toBe(Infinity)
  expect(asLimit('2', 'limit')).toBe(2)
  expect(() => asLimit(Symbol('bad'), 'limit')).toThrow(
    'limit must be a positive integer or Infinity',
  )
  expect(() => asLimit(1.5, 'limit')).toThrow('limit must be a positive integer or Infinity')
})

test.each(['-', '1.', '1e', '1e+', '--1'])(
  'JSON parser core rejects invalid number %s',
  (input) => {
    expect(() => parse([input])).toThrow('Invalid JSON number')
  },
)

test('JSON parser core rejects a leading plus as a non-value token', () => {
  expect(() => parse(['+1'])).toThrow('Expected a JSON value')
})

test('JSON parser core locates a record error from non-default starting coordinates', () => {
  expect(() => parse(['{\n"bad":}'], { baseLine: 10, baseOffset: 100, record: 7 })).toThrowError(
    expect.objectContaining({
      column: 7,
      line: 11,
      offset: 108,
      record: 7,
    }),
  )
})

test('JSON parser core reports every incomplete terminal token', () => {
  for (const input of ['t', 'fa', 'nul', '"open', '"escape\\', '"unicode\\u12']) {
    expect(() => parse([input])).toThrow('Unexpected end of JSON')
  }
  expect(() => parse(['[1'])).toThrow('Unexpected end of JSON input')
})