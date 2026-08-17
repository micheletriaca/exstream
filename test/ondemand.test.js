/* oxlint-disable vitest/no-commented-out-tests -- historical manual performance probes below */
const _ = require('../src')
// const __ = require('highland')
const h = require('./helpers')
// const { Readable } = require('stream')
// const fs = require('fs')

test('basic', async () => {
  const xs = _([1, 2, 3])
  const iterator = xs[Symbol.asyncIterator]()
  expect(await iterator.next()).toEqual({ done: false, value: 1 })
  await h.sleep(200)
  expect(await iterator.next()).toEqual({ done: false, value: 2 })
  expect(await iterator.next()).toEqual({ done: false, value: 3 })
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
})

test('basic async', async () => {
  const xs = _([1, 2, 3])
    .map(async (x) => x)
    .resolve()
  const iterator = xs[Symbol.asyncIterator]()
  expect(await iterator.next()).toEqual({ done: false, value: 1 })
  expect(await iterator.next()).toEqual({ done: false, value: 2 })
  expect(await iterator.next()).toEqual({ done: false, value: 3 })
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
})

test('basic error handling', async () => {
  const xs = _([1, 2, 3])
    .map(async (x) => {
      if (x === 2) throw Error('NOO')
      return x
    })
    .resolve()
  const iterator = xs[Symbol.asyncIterator]()
  expect(await iterator.next()).toEqual({ done: false, value: 1 })
  await expect(iterator.next()).rejects.toThrow('NOO')
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
})

/*
test('testPerformance - batched async iteration', async () => {
  const x = Array(50000).fill(0).map((x, i) => i)
  const xs = _(x).map(async x => x).resolve().batch(10000)
  let k
  console.time('t')
  for (let i = 0; i < 5; i++) {
    k = await xs[Symbol.asyncIterator]().next()
  }
  console.timeEnd('t')
  expect(k[k.length - 1]).toBe(49999)
})
test('testPerformance - values', async () => {
  const x = Array(50000).fill(0).map((x, i) => i)
  const xs = _(x).map(async x => x).resolve()
  console.time('t')
  const k = (await xs.toArray())[49999]
  console.timeEnd('t')
  expect(k).toBe(49999)
})

vi.setConfig({ testTimeout: 20000 })
test('testPerformance - highland', async () => {
  const x = Array(50000).fill(0).map((x, i) => i)
  const xs = __(x).map(async x => x).flatMap(__)
  console.time('t')
  const k = (await xs.collect().toPromise(Promise))[49999]
  console.timeEnd('t')
  expect(k).toBe(49999)
})

test('testPerformance - plain js', async () => {
  const p = async x => x
  console.time('t')
  let k
  for (let i = 0; i < 50000; i++) {
    k = await p(i)
  }
  console.timeEnd('t')
  expect(k).toBe(49999)
})
*/