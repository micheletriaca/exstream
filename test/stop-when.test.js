const _ = require('../src/index.js')
const h = require('./helpers.js')

test('stopWhen', () => {
  const res = _([1, 2, 3, 4, 5, 6])
    .stopWhen(x => x === 5)
    .values()
  expect(res).toEqual([1, 2, 3, 4, 5])
})

test('stopWhenAsync', async () => {
  const res = await _([1, 2, 3, 4, 5, 6])
    .map(async x => {
      await h.sleep(10)
      return x
    })
    .resolve()
    .map(x => x * 2)
    .stopWhen(x => x === 10)
    .values()
  expect(res).toEqual([2, 4, 6, 8, 10])
})

test('stop edge 1', () => {
  const res = _([1, 2, 3])
    .stopWhen(x => x === 10)
    .values()
  expect(res).toEqual([1, 2, 3])
})

test('stop edge - 2', () => {
  const res = _([10])
    .stopWhen(x => x === 10)
    .values()
  expect(res).toEqual([10])
})
