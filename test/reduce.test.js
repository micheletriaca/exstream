const _ = require('../src/index.js')
const h = require('./helpers.js')
jest.mock('fs')
const fs = require('fs')

const out = [...h.randomStringGenerator(10000)].map(x => x.toString() + '\n')

beforeEach(() => {
  fs.__setMockFiles({ out })
})

test('reduce', () => {
  const res = _([1, 2, 3])
    .reduce(0, (memo, x) => memo + x)
    .value()
  expect(res).toEqual([6])
})

test('reduce1', () => {
  const res = _([1, 2, 3])
    .reduce1((memo, x) => memo + x)
    .value()
  expect(res).toEqual([6])
})

test('reduce1', () => {
  const res = _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .reduce1((memo, x) => ({ ...memo, ...x }))
    .value()
  expect(res).toEqual([{ a: 2, b: 1 }])
})

test('async reduce', async () => {
  const res = await _([1, 2, 3])
    .asyncReduce(0, async (memo, x) => {
      await h.sleep(10)
      return memo + x
    })
    .toPromise()
  expect(res).toEqual([6])
})
