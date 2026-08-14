require('../src/index.js')
const { createEncodedByteCounter, createUtf8ByteCounter } = require('../src/byte-counter.js')

test.each([
  ['ASCII', 5],
  ['€', 3],
  ['💥', 4],
  ['a€💥', 8],
  ['\ud83d', 3],
  ['\udca5', 3],
])('UTF-8 byte counter matches encoded size for %j', (value, bytes) => {
  const counter = createUtf8ByteCounter()
  counter.add(value)
  expect(counter.finish()).toBe(bytes)
})

test('UTF-8 byte counter joins surrogate pairs across arbitrary additions', () => {
  const counter = createUtf8ByteCounter()
  expect(counter.add('\ud83d')).toBe(0)
  expect(counter.add('\udca5')).toBe(4)
  expect(counter.finish()).toBe(4)

  counter.reset()
  expect(counter.add('€')).toBe(3)
  expect(counter.add('\ud83d')).toBe(3)
  expect(counter.add('x')).toBe(7)
  expect(counter.finish()).toBe(7)

  counter.add('\ud83d')
  counter.reset()
  expect(counter.add('a')).toBe(1)
})

test('UTF-8 byte counter reports the first value beyond a limit', () => {
  const exceeded = vi.fn()
  const counter = createUtf8ByteCounter(3, exceeded)
  counter.add('€')
  expect(exceeded).not.toHaveBeenCalled()
  counter.add('x')
  expect(exceeded).toHaveBeenCalledWith(4)
})

test('encoded byte counter supports UTF-8 aliases and Node encodings', () => {
  for (const encoding of ['utf8', 'utf-8', 'UTF_8']) {
    const counter = createEncodedByteCounter(encoding)
    counter.add('€')
    expect(counter.finish()).toBe(3)
  }

  const utf16 = createEncodedByteCounter('utf16le')
  expect(utf16.add('€')).toBe(2)
  expect(utf16.add('a')).toBe(4)
  expect(utf16.finish()).toBe(4)
  utf16.reset()
  expect(utf16.finish()).toBe(0)
})

test('encoded byte counter enforces limits for non-UTF-8 encodings', () => {
  const exceeded = vi.fn()
  const counter = createEncodedByteCounter('utf16le', 2, exceeded)
  counter.add('a')
  expect(exceeded).not.toHaveBeenCalled()
  counter.add('b')
  expect(exceeded).toHaveBeenCalledWith(4)
})

test('byte counters still report size when a limit has no failure callback', () => {
  const utf8 = createUtf8ByteCounter(1)
  expect(utf8.add('€')).toBe(3)
  expect(utf8.finish()).toBe(3)

  const utf16 = createEncodedByteCounter('utf16le', 1)
  expect(utf16.add('a')).toBe(2)
  expect(utf16.finish()).toBe(2)
})