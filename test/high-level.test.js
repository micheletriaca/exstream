const _ = require('../src')
const h = require('./helpers')

test('basic ext sort', async () => {
  const results = await _([3, 1, 2, 20, 21, 4])
    .externalSortBy((a, b) => a > b ? 1 : -1, 2)
    .values()

  expect(results).toEqual([1, 2, 3, 4, 20, 21])
})

test('basic ext sort - default param', async () => {
  const results = await _([3, 1, 2, 20, 21, 4])
    .externalSortBy((a, b) => a > b ? 1 : -1)
    .values()

  expect(results).toEqual([1, 2, 3, 4, 20, 21])
})

test('basic ext sort - error in source', async () => {
  let exc
  const results = await _([3, 1, 2, 20, 21, 4])
    .map(x => {
      if (x === 1) throw Error('NOO')
      return x
    })
    .externalSortBy((a, b) => a > b ? 1 : -1)
    .errors(e => (exc = e))
    .values()

  expect(exc.message).toBe('NOO')
  expect(results).toEqual([])
})

test('ext sort back pressure', async () => {
  const sourceStream = _([3, 1, 2, 20, 21, 4]).externalSortBy((a, b) => a > b ? 1 : -1, 2)
  const results = await sourceStream
    .map(async x => {
      await h.sleep(10)
      expect(sourceStream.paused).toBe(true)
      return x
    })
    .resolve()
    .values()

  expect(results).toEqual([1, 2, 3, 4, 20, 21])
})

test('ext sort no back pressure', async () => {
  const sourceStream = _([3, 1, 2, 20, 21, 4]).externalSortBy((a, b) => a > b ? 1 : -1, 2)
  const results = await sourceStream
    .map(x => {
      expect(sourceStream.paused).toBe(false)
      return x
    })
    .values()

  expect(results).toEqual([1, 2, 3, 4, 20, 21])
})

test('ext sort slow reader', async () => {
  const sourceStream = _([3, 1, 2, 20, 21, 4]).map(async x => {
    await h.sleep(10)
    return x
  }).resolve().externalSortBy((a, b) => a > b ? 1 : -1, 2)

  const results = await sourceStream
    .map(x => {
      expect(sourceStream.paused).toBe(false)
      return x
    })
    .values()

  expect(results).toEqual([1, 2, 3, 4, 20, 21])
})
