const _ = require('../src/index.js')

test('pluck on non object', () => {
  _([1, 2, 3]).pluck('a').toArray(res => {
    expect(res).toEqual([undefined, undefined, undefined])
  })
})

test('pluck', () => {
  _([{ a: 1 }, { a: 2 }, { a: 3 }, { b: 1 }]).pluck('a').toArray(res => {
    expect(res).toEqual([1, 2, 3, undefined])
  })
})

test('pluck nested', () => {
  _([{ a: { b: { c: [1, 2, 3] } } }, { a: 2 }, { a: 3 }, { b: 1 }])
    .pluck('a.b.c[1]')
    .toArray(res => {
      expect(res).toEqual([2, undefined, undefined, undefined])
    })
})

test('pluck default values', () => {
  _([{ a: { b: { c: [1, 2, 3] } } }, { a: 2 }, { a: 3 }, { b: 1 }])
    .pluck('a.b.c[1]', -1)
    .toArray(res => {
      expect(res).toEqual([2, -1, -1, -1])
    })
})

test('pick', () => {
  const res = _([{ a: 1, b: 2, c: 3 }, { a: 1, c: 3 }, { b: 2, c: 3 }]).pick(['a', 'c']).values()
  expect(res).toEqual([{ a: 1, c: 3 }, { a: 1, c: 3 }, { c: 3 }])
})

test('pick on non object', () => {
  let exc = false
  try {
    _([1, 2, 3]).pick(['a']).values()
  } catch (e) {
    exc = true
  }
  expect(exc).toBe(true)
})
