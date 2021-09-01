const _ = require('../src/index.js')
const h = require('./helpers.js')

test('reduce', () => {
  const res = _([1, 2, 3])
    .reduce((memo, x) => memo + x, 0)
    .value()
  expect(res).toEqual(6)
})

test('reduce1 - sum', () => {
  const res = _([1, 2, 3])
    .reduce1((memo, x) => memo + x)
    .value()
  expect(res).toEqual(6)
})

test('reduce1 - to object', () => {
  const res = _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .reduce1((memo, x) => ({ ...memo, ...x }))
    .value()
  expect(res).toEqual({ a: 2, b: 1 })
})

test('reduce from empty list', () => {
  const res = _([])
    .reduce((memo, x) => memo + x, 0)
    .value()
  expect(res).toEqual(0)
})

test('reduce1 from empty list', () => {
  const res = _([])
    .reduce1((memo, x) => memo + x)
    .value()
  expect(res).toEqual(undefined)
})

test('reduce1 after pluck', () => {
  const res = _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .pluck('a')
    .compact()
    .reduce1((memo, x) => memo + x)
    .value()
  expect(res).toEqual(3)
})

test('reduce after pluck', () => {
  const res = _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .pluck('a')
    .reduce((memo, x) => memo + x, 0)
    .value()
  expect(res).toEqual(NaN)
})

test('reduce1 in async chain', async () => {
  const res = await _([1, 2, 3])
    .map(async x => {
      await h.sleep(10)
      return x
    })
    .resolve()
    .reduce1((memo, x) => memo + x)
    .toPromise()

  expect(res).toEqual([6])
})

test('async reduce', async () => {
  const res = await _([1, 2, 3])
    .asyncReduce(async (memo, x) => {
      await h.sleep(10)
      return memo + x
    }, 0)
    .toPromise()
  expect(res).toEqual([6])
})
