const codecs = require('../src/web-codecs.js')

test('web codecs convert supported byte-like values to Uint8Array', () => {
  const buffer = new ArrayBuffer(4)
  new Uint8Array(buffer).set([1, 2, 3, 4])
  const view = new Uint16Array(buffer, 0, 1)

  expect(codecs.asUint8Array('€')).toEqual(new Uint8Array([0xe2, 0x82, 0xac]))
  expect(codecs.asUint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]))
  expect(codecs.asUint8Array(view)).toEqual(new Uint8Array(buffer, 0, 2))
  expect(codecs.asUint8Array([5, 6])).toEqual(new Uint8Array([5, 6]))
  expect(codecs.asUint8Array(new Uint8Array([7]))).toEqual(new Uint8Array([7]))
})

test('web codecs reject text encodings unavailable through TextEncoder', () => {
  expect(() => codecs.asUint8Array('text', 'latin1')).toThrow(
    'encoding latin1 is not supported in this runtime',
  )
})

test('web codecs concatenate, compare, search, and decode byte ranges', () => {
  const first = new Uint8Array([65, 66])
  const second = new Uint8Array([67, 68])
  const combined = codecs.concatBytes([first, second], 4)

  expect(combined).toEqual(new Uint8Array([65, 66, 67, 68]))
  expect(codecs.bytesEqual(combined, new Uint8Array([65, 66, 67, 68]))).toBe(true)
  expect(codecs.bytesEqual(combined, new Uint8Array([65, 66]))).toBe(false)
  expect(codecs.bytesEqual(combined, new Uint8Array([65, 66, 67, 69]))).toBe(false)
  expect(codecs.indexOfByte(combined, 67)).toBe(2)
  expect(codecs.indexOfByte(combined, 65, 1)).toBe(-1)
  expect(codecs.decodeBytes(combined, 'utf8', 1, 3)).toBe('BC')
})

test('web text bytes expose the parser byte interface without Buffer', () => {
  const bytes = codecs.concatTextBytes([new Uint8Array([65, 66]), new Uint8Array([67, 68])], 4)

  expect(bytes).toBeInstanceOf(Uint8Array)
  expect(bytes.toString('utf8', 1, 3)).toBe('BC')
  expect(bytes.equals(new Uint8Array([65, 66, 67, 68]))).toBe(true)
  expect(bytes.equals(new Uint8Array([65, 66, 67, 69]))).toBe(false)
})

test('web streaming text decoder preserves split UTF-8 code points', () => {
  const decoder = codecs.createStringDecoder('utf8')

  expect(decoder.write(new Uint8Array([0x41, 0xe2]))).toBe('A')
  expect(decoder.write(new Uint8Array([0x82]))).toBe('')
  expect(decoder.write(new Uint8Array([0xac, 0x42]))).toBe('€B')
  expect(decoder.end()).toBe('')
})

test('web base64 encoder retains incomplete triples between chunks', () => {
  const encoder = codecs.createBase64Encoder()

  expect(encoder.write(new Uint8Array([1]))).toBe('')
  expect(encoder.write(new Uint8Array([2, 3, 4]))).toBe('AQID')
  expect(encoder.end()).toBe('BA==')
  expect(encoder.end()).toBe('')
})

test('web base64 decoder returns Uint8Array', () => {
  expect(codecs.decodeBase64('AQIDBA==')).toEqual(new Uint8Array([1, 2, 3, 4]))
})