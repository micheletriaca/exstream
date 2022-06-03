/* eslint-disable jest/no-commented-out-tests */
const _ = require('../src')
// const __ = require('highland')
const h = require('./helpers')
// const { Readable } = require('stream')
// const fs = require('fs')

test('basic', async () => {
  const xs = _([1, 2, 3])
  expect(await xs.pull()).toEqual(1)
  await h.sleep(200)
  expect(await xs.pull()).toEqual(2)
  expect(await xs.pull()).toEqual(3)
  expect(await xs.pull()).toEqual(_.nil)
})

test('basic async', async () => {
  const xs = _([1, 2, 3]).map(async x => x).resolve()
  expect(await xs.pull()).toEqual(1)
  expect(await xs.pull()).toEqual(2)
  expect(await xs.pull()).toEqual(3)
  expect(await xs.pull()).toEqual(_.nil)
})

test('basic error handling', async () => {
  const xs = _([1, 2, 3]).map(async x => {
    if (x === 2) throw Error('NOO')
    return x
  }).resolve()
  expect(await xs.pull()).toEqual(1)
  let exc
  try {
    await xs.pull()
  } catch (e) { exc = e }
  expect(exc.message).toBe('NOO')
  expect(await xs.pull()).toEqual(3)
  expect(await xs.pull()).toEqual(_.nil)
})

/*
test('testPerformance - batched pull', async () => {
  const x = Array(50000).fill(0).map((x, i) => i)
  const xs = _(x).map(async x => x).resolve().batch(10000)
  let k
  console.time('t')
  for (let i = 0; i < 5; i++) {
    k = await xs.pull()
  }
  console.timeEnd('t')
  expect(k[k.length - 1]).toBe(49999)
})
test('testPerformance - values', async () => {
  const x = Array(50000).fill(0).map((x, i) => i)
  const xs = _(x).map(async x => x).resolve()
  console.time('t')
  const k = (await xs.values())[49999]
  console.timeEnd('t')
  expect(k).toBe(49999)
})

jest.setTimeout(20000)
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
