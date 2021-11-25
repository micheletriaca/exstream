const _ = require('../src/index.js')

const dataset = [
  { id: 1, value: '1' },
  { id: 2, value: '2' },
  { id: 3, value: '3' },
]

test('keyby', () => {
  const res = _(dataset)
    .keyby('id')
    .value()
  expect(res).toEqual({
    1: { id: 1, value: '1' },
    2: { id: 2, value: '2' },
    3: { id: 3, value: '3' },
  })
})

test('wrong / missing key', () => {
  const error = jest.fn()
  _(dataset)
    .keyby('wrong')
    .errors(error)
    .value()
  expect(error).toHaveBeenCalledTimes(3)
})
