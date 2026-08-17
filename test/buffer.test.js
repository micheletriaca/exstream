const _ = require('../src/index.js')

test('buffer limit exposes current and peak usage', () => {
  const source = _(null, { bufferLimit: 2 })

  expect(source.buffered).toBe(0)
  expect(source.peakBuffered).toBe(0)
  expect(source.bufferLimit).toBe(2)
  expect(source.overflowPolicy).toBe('error')

  source.write(1)
  source.write(2)

  expect(source.buffered).toBe(2)
  expect(source.peakBuffered).toBe(2)
  expect(() => source.write(3)).toThrow(_.BufferOverflowError)
  expect(source.buffered).toBe(2)

  source.destroy()
  expect(source.buffered).toBe(0)
  expect(source.peakBuffered).toBe(2)
})

test.each([
  [{ bufferLimit: -1 }, 'bufferLimit must be a non-negative integer or Infinity'],
  [{ bufferLimit: 1.5 }, 'bufferLimit must be a non-negative integer or Infinity'],
  [{ bufferLimit: Symbol('limit') }, 'bufferLimit must be a non-negative integer or Infinity'],
  [{ overflow: 'silent' }, 'overflow must be one of: error, drop-oldest, drop-newest'],
  [{ overflow: 'drop-oldest' }, 'best-effort overflow requires a finite bufferLimit'],
])('invalid buffer options fail during construction', (options, message) => {
  expect(() => _(null, options)).toThrow(message)
})

test('drop-oldest retains the newest bounded values', async () => {
  const source = _(null, { bufferLimit: 2, overflow: 'drop-oldest' })

  source.write(1)
  source.write(2)
  source.write(3)

  expect(source.buffered).toBe(2)
  expect(source.peakBuffered).toBe(2)
  expect(source.dropped).toBe(1)
  const iterator = source[Symbol.asyncIterator]()
  await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 })
  await expect(iterator.next()).resolves.toEqual({ done: false, value: 3 })
  await iterator.return()
  expect(source.buffered).toBe(0)
})

test('drop-newest retains the oldest bounded values', async () => {
  const source = _(null, { bufferLimit: 2, overflow: 'drop-newest' })

  source.write(1)
  source.write(2)
  source.write(3)

  expect(source.buffered).toBe(2)
  expect(source.peakBuffered).toBe(2)
  expect(source.dropped).toBe(1)
  const iterator = source[Symbol.asyncIterator]()
  await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
  await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 })
  await iterator.return()
  expect(source.buffered).toBe(0)
})

test('a zero buffer limit drops every best-effort value', async () => {
  const source = _(null, { bufferLimit: 0, overflow: 'drop-oldest' })

  source.write(1)
  source.write(2)

  expect(source.buffered).toBe(0)
  expect(source.peakBuffered).toBe(0)
  expect(source.dropped).toBe(2)
  await source[Symbol.asyncIterator]().return()
})

test('a bounded observer drops old values without affecting its source', async () => {
  const source = _([1, 2, 3, 4, 5])
  const observer = source.observe({ bufferLimit: 2, overflow: 'drop-oldest' })

  expect(await source.toArray()).toEqual([1, 2, 3, 4, 5])
  expect(observer.buffered).toBe(2)
  expect(observer.peakBuffered).toBe(2)
  expect(observer.dropped).toBe(3)
  expect(await observer.toArray()).toEqual([4, 5])
  expect(observer.buffered).toBe(0)
})

test('observer overflow aborts only the observer', async () => {
  const source = _([1, 2, 3])
  const observer = source.observe({ bufferLimit: 1 })
  const sibling = source.observe()

  expect(await source.toArray()).toEqual([1, 2, 3])
  expect(source.state).toBe('ended')
  expect(observer.state).toBe('aborted')
  expect(observer.abortReason).toBeInstanceOf(_.BufferOverflowError)
  expect(observer.abortReason.code).toBe('EXSTREAM_BUFFER_OVERFLOW')
  expect(await sibling.toArray()).toEqual([1, 2, 3])
})

test('an observer destroyed early remains detached from source lifecycle', async () => {
  const source = _([1, 2, 3])
  const observer = source.observe()

  observer.destroy()

  expect(await source.toArray()).toEqual([1, 2, 3])
  expect(source.state).toBe('ended')
  expect(observer.state).toBe('destroyed')
  expect(observer.buffered).toBe(0)
})