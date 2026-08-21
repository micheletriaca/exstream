const _ = require('../src/index.js')

test('pluck on non object', async () => {
  await ((res) => {
    expect(res).toEqual([undefined, undefined, undefined])
  })(await _([1, 2, 3]).pluck('a').toArray())
})

test('pluck with empty param is invalid', async () => {
  expect.assertions(1)
  try {
    await ((res) => {
      expect(res).toEqual([undefined, undefined, undefined])
    })(await _([1, 2, 3]).pluck().toArray())
  } catch (e) {
    expect(e.message).toBe('error in .pluck(). expected string, got undefined')
  }
})

test('pluck with a param != string is invalid', async () => {
  expect.assertions(1)
  try {
    await ((res) => {
      expect(res).toEqual([undefined, undefined, undefined])
    })(await _([1, 2, 3]).pluck({}).toArray())
  } catch (e) {
    expect(e.message).toBe('error in .pluck(). expected string, got undefined')
  }
})

test('pluck', async () => {
  await ((res) => {
    expect(res).toEqual([1, 2, 3, undefined])
  })(
    await _([{ a: 1 }, { a: 2 }, { a: 3 }, { b: 1 }])
      .pluck('a')
      .toArray(),
  )
})

test('pluck nested', async () => {
  await ((res) => {
    expect(res).toEqual([2, undefined, undefined, undefined])
  })(
    await _([{ a: { b: { c: [1, 2, 3] } } }, { a: 2 }, { a: 3 }, { b: 1 }])
      .pluck('a.b.c[1]')
      .toArray(),
  )
})

test('pluck default values', async () => {
  await ((res) => {
    expect(res).toEqual([2, -1, -1, -1])
  })(
    await _([{ a: { b: { c: [1, 2, 3] } } }, { a: 2 }, { a: 3 }, { b: 1 }])
      .pluck('a.b.c[1]', -1)
      .toArray(),
  )
})

test('pick', async () => {
  const res = await _([
    { a: 1, b: 2, c: 3 },
    { a: 1, c: 3 },
    { b: 2, c: 3 },
  ])
    .pick(['a', 'c'])
    .toArray()
  expect(res).toEqual([{ a: 1, c: 3 }, { a: 1, c: 3 }, { c: 3 }])
})

test('pick on non object', async () => {
  let exc = false
  try {
    await _([1, 2, 3]).pick(['a']).toArray()
  } catch (e) {
    exc = true
  }
  expect(exc).toBe(true)
})

test('omit', async () => {
  const res = await _([
    { a: 1, b: 2, c: 3 },
    { a: 1, c: 3 },
    { b: 2, c: 3 },
  ])
    .omit(['a', 'c'])
    .toArray()
  expect(res).toEqual([{ b: 2 }, {}, { b: 2 }])
})

test('omit single property', async () => {
  const res = await _([
    { a: 1, b: 2, c: 3 },
    { a: 1, c: 3 },
    { b: 2, c: 3 },
  ])
    .omit('a')
    .toArray()
  expect(res).toEqual([{ b: 2, c: 3 }, { c: 3 }, { b: 2, c: 3 }])
})

test('omit on non object', async () => {
  let exc = false
  try {
    await _([1, 2, 3]).omit(['a']).toArray()
  } catch (e) {
    exc = true
  }
  expect(exc).toBe(true)
})