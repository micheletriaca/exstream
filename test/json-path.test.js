const { JSON_PATH_WILDCARD, parseJsonPath, stringifyPath } = require('../src/json-path.js')

test('JSON paths support the declared streamable subset', () => {
  expect(parseJsonPath('$')).toEqual([])
  expect(parseJsonPath('$.data.items[*]')).toEqual(['data', 'items', JSON_PATH_WILDCARD])
  expect(parseJsonPath("$['strange.name'][0]['it\\'s']")).toEqual(['strange.name', 0, "it's"])
  expect(parseJsonPath('$[0][*].value')).toEqual([0, JSON_PATH_WILDCARD, 'value'])
})

test.each([
  '',
  null,
  '$..items',
  '$[?(@.active)]',
  '$[-1]',
  '$[0:2]',
  '$[0,1]',
  '$.items[01]',
  '$.*',
  'items[*]',
  '$.items-tail',
  "$['unterminated]",
  "$['property'x]",
  "$['bad\\q']",
  "$['bad\\u12xz']",
  "$['control\nproperty']",
  '$[999999999999999999999999999]',
])('JSON paths reject non-streamable syntax: %s', (path) => {
  expect(() => parseJsonPath(path)).toThrow('Unsupported JSON path')
})

test('JSON paths decode quoted property escapes', () => {
  expect(parseJsonPath("$['line\\nfeed']['\\u20ac'][\"quoted\\\"name\"]")).toEqual([
    'line\nfeed',
    '€',
    'quoted"name',
  ])
})

test('JSON stringify paths require one terminal wildcard under object properties', () => {
  expect(stringifyPath()).toEqual([])
  expect(stringifyPath('$.data.items[*]')).toEqual(['data', 'items'])
  expect(stringifyPath("$['data.items'][*]")).toEqual(['data.items'])
  expect(() => stringifyPath('$.items')).toThrow('must end in [*]')
  expect(() => stringifyPath('$[0][*]')).toThrow('property segments only')
  expect(() => stringifyPath('$.items[*].nested[*]')).toThrow('property segments only')
})