const _ = require('../src/index.js')

const dataset = [
  { id: 1, value: '1' },
  { id: 2, value: '2' },
  { id: 3, value: '3' },
]

test('keyBy', () => {
  const res = _(dataset)
    .keyBy('id')
    .value()
  expect(res).toEqual({
    1: { id: 1, value: '1' },
    2: { id: 2, value: '2' },
    3: { id: 3, value: '3' },
  })
})

test('wrong / missing key', () => {
  const error = jest.fn()
  const res = _(dataset)
    .keyBy('wrong')
    .errors(error)
    .value()
  expect(res).toEqual({})
  expect(error).toHaveBeenCalledTimes(0)
})

test('multiple values per key', () => {
  const error = jest.fn()
  _([...dataset, { id: 3, value: '4' }])
    .keyBy('id')
    .errors(error)
    .value()
  expect(error).toHaveBeenCalledTimes(1)
})
