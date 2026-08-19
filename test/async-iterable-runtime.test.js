const _ = require('../src/index.js')
const { configureRuntime, runtime } = require('../src/runtime.js')
const { nextTurn } = require('./invariant-helpers.js')
const { kDestroy, kResume } = require('../src/stream-control.js')

let readableFromAsyncIterable

beforeEach(() => {
  readableFromAsyncIterable = runtime.readableFromAsyncIterable
  configureRuntime({ readableFromAsyncIterable: null })
})

afterEach(() => {
  configureRuntime({ readableFromAsyncIterable })
})

test('the portable runtime consumes async iterables without a Node stream', async () => {
  const iterable = {
    async *[Symbol.asyncIterator]() {
      yield 1
      yield 2
    },
  }

  await expect(_(iterable).toArray()).resolves.toEqual([1, 2])
})

test('the portable runtime forwards async iterator rejection', async () => {
  const reason = Error('async iterator failure')
  const iterable = {
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.reject(reason),
      }
    },
  }

  await expect(_(iterable).toArray()).rejects.toBe(reason)
})

test('destroying the portable async iterable calls return', async () => {
  const returned = vi.fn()
  const iterable = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
        return: returned,
      }
    },
  }
  const source = _(iterable)

  source[kResume]()
  await nextTurn()
  source[kDestroy]()

  expect(returned).toHaveBeenCalledOnce()
})

test('destroying a portable async iterator without return is safe', () => {
  const iterable = {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise(() => {}) }
    },
  }
  const source = _(iterable)

  expect(() => source[kDestroy]()).not.toThrow()
})