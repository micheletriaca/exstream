const __ = require('../src/index.js')

test('flatten', () => {
  const result = __([])
    .flatten()
    .values()
  expect(result).toEqual([])
})
