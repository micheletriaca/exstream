const _ = require('../src/index.js')

test('flatten', () => {
  const result = _([])
    .flatten()
    .values()
  expect(result).toEqual([])
})

test('flatten2', () => {
  const result = _([[1,2,3], [4,5,6]])
    .flatten()
    .values()
  expect(result).toEqual([1,2,3,4,5,6])
})

test('flatten don\'t flat a string', () => {
  const result = _(['string'])
    .flatten()
    .values()
  expect(result).toEqual(['string'])
})
