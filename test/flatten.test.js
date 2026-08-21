const _ = require('../src/index.js')

test('flatten - empty stream', async () => {
  const result = await _([]).flatten().toArray()
  expect(result).toEqual([])
})

test('flatten - basic', async () => {
  const result = await _([
    [1, 2, 3],
    [4, 5, 6],
  ])
    .flatten()
    .toArray()
  expect(result).toEqual([1, 2, 3, 4, 5, 6])
})

test("flatten doesn't flat a string", async () => {
  const result = await _(['string']).flatten().toArray()
  expect(result).toEqual(['string'])
})