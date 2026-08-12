const { runtime } = require('../src/runtime.js')
require('../src/node-runtime.js')

test('the Node runtime joins contiguous parser chunks without copying', () => {
  const input = Buffer.from('contiguous')
  const joined = runtime.concatTextBytes(
    [input.subarray(0, 3), input.subarray(3, 7), input.subarray(7)],
    input.length,
  )

  expect(joined.buffer).toBe(input.buffer)
  expect(joined.byteOffset).toBe(input.byteOffset)
  expect(joined.toString()).toBe('contiguous')
})

test('the Node runtime copies parser chunks with unrelated backing stores', () => {
  const first = Buffer.allocUnsafeSlow(2).fill('a')
  const second = Buffer.allocUnsafeSlow(2).fill('b')
  const joined = runtime.concatTextBytes([first, second], 4)

  expect(joined.toString()).toBe('aabb')
  expect(joined.buffer).not.toBe(first.buffer)
  expect(joined.buffer).not.toBe(second.buffer)
})

test('the Node runtime presents Uint8Array input as a zero-copy Buffer view', () => {
  const input = new Uint8Array([65, 66, 67])
  const bytes = runtime.asBytes(input)

  expect(Buffer.isBuffer(bytes)).toBe(true)
  expect(bytes.buffer).toBe(input.buffer)
  expect(bytes.toString()).toBe('ABC')
})

test('the Node byte adapter covers Buffer, ArrayBuffer, and empty concatenation', () => {
  const buffer = Buffer.from('buffer')
  expect(runtime.asBytes(buffer)).toBe(buffer)

  const arrayBuffer = new Uint8Array([65, 66]).buffer
  expect(runtime.asBytes(arrayBuffer).toString()).toBe('AB')
  expect(runtime.concatTextBytes([], 0)).toEqual(Buffer.alloc(0))
})