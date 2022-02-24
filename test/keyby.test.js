const _ = require('../src/index.js')

const dataset = [
  { id: 1, value: '1', parent: { id: 'p1' } },
  { id: 2, value: '2', parent: { id: 'p2' } },
  { id: 3, value: '3', parent: { id: 'p3' } },
]

test('keyBy', () => {
  const res = _(dataset)
    .keyBy('id')
    .value()
  expect(res).toEqual({
    1: { id: 1, value: '1', parent: { id: 'p1' } },
    2: { id: 2, value: '2', parent: { id: 'p2' } },
    3: { id: 3, value: '3', parent: { id: 'p3' } },
  })
})

test('keyByNested', () => {
  const res = _(dataset)
    .keyBy('parent.id')
    .value()
  expect(res).toEqual({
    p1: { id: 1, value: '1', parent: { id: 'p1' } },
    p2: { id: 2, value: '2', parent: { id: 'p2' } },
    p3: { id: 3, value: '3', parent: { id: 'p3' } },
  })
})

test('keyByFn', () => {
  const res = _(dataset)
    .keyBy(x => x.parent.id)
    .value()
  expect(res).toEqual({
    p1: { id: 1, value: '1', parent: { id: 'p1' } },
    p2: { id: 2, value: '2', parent: { id: 'p2' } },
    p3: { id: 3, value: '3', parent: { id: 'p3' } },
  })
})

test('wrong / missing key', () => {
  const error = jest.fn()
  const res = _(dataset)
    .keyBy('wrong')
    .errors(error)
    .value()
  // it fails because more than 1 item is keyed by _.nil
  expect(res).toBeUndefined()
  expect(error).toHaveBeenCalledTimes(1)
})

test('multiple values per key', () => {
  const error = jest.fn()
  _([...dataset, { id: 3, value: '4' }])
    .keyBy('id')
    .errors(error)
    .value()
  expect(error).toHaveBeenCalledTimes(1)
})

test('key by null', () => {
  const res = _([{ a: 1 }, { a: null }])
    .keyBy('a')
    .value()

  expect(Object.keys(res)).toEqual(['1'])
  expect(JSON.stringify(res)).toBe('{"1":{"a":1}}')
  expect(res).toEqual({ 1: { a: 1 }, [_.nil]: { a: null } })
})
