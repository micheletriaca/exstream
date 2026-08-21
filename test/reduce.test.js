const _ = require('../src/index.js')
const h = require('./helpers.js')

test('reduce', async () => {
  const res = await _([1, 2, 3])
    .reduce((memo, x) => memo + x, 0)
    .single()
  expect(res).toEqual(6)
})

test('reduce without initial value - sum', async () => {
  const res = await _([1, 2, 3])
    .reduce((memo, x) => memo + x)
    .single()
  expect(res).toEqual(6)
})

test('reduce without initial value - to object', async () => {
  const res = await _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .reduce((memo, x) => Object.assign({}, memo, x))
    .single()
  expect(res).toEqual({ a: 2, b: 1 })
})

test('reduce from empty list', async () => {
  const res = await _([])
    .reduce((memo, x) => memo + x, 0)
    .single()
  expect(res).toEqual(0)
})

test('reduce without initial value from empty list', async () => {
  const res = await _([])
    .reduce((memo, x) => memo + x)
    .toArray()
  expect(res).toEqual([])
})

test('reduce without initial value after pluck', async () => {
  const res = await _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .pluck('a')
    .compact()
    .reduce((memo, x) => memo + x)
    .single()
  expect(res).toEqual(3)
})

test('reduce after pluck', async () => {
  const res = await _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .pluck('a')
    .reduce((memo, x) => memo + x, 0)
    .single()
  expect(res).toEqual(NaN)
})

test('reduce without initial value in async chain', async () => {
  const res = await _([1, 2, 3])
    .map(async (x) => {
      await h.sleep(10)
      return x
    })
    .mapAsync((value) => value)
    .reduce((memo, x) => memo + x)
    .toArray()

  expect(res).toEqual([6])
})

test('reduce errors', async () => {
  let e = null
  try {
    await _([1, 2, 3])
      .reduce((memo, x) => {
        if (x === 3) throw Error('NOOO')
        return memo + x
      }, 0)
      .single()
  } catch (ex) {
    e = ex
  }
  expect(e).not.toBe(null)
  expect(e.message).toBe('NOOO')
})

test('reduce errors - 2', async () => {
  let e = null
  const res = await _([1, 2, 3])
    .reduce((memo, x) => {
      if (x === 3) throw Error('NOOO')
      return memo + x
    }, 0)
    .errors((ex) => void (e = ex))
    .single()
  expect(e).not.toBe(null)
  expect(e.message).toBe('NOOO')
  expect(res).toBeUndefined()
})

test('reduce without initial value errors', async () => {
  let e = null
  const res = await _([1, 2, 3])
    .reduce((memo, x) => {
      if (x === 3) throw Error('NOOO')
      return memo + x
    })
    .errors((ex) => void (e = ex))
    .single()
  expect(e).not.toBe(null)
  expect(e.message).toBe('NOOO')
  expect(res).toBeUndefined()
})

test('reduce without initial value errors - 2', async () => {
  let e = null
  try {
    await _([1, 2, 3])
      .reduce((memo, x) => {
        if (x === 3) throw Error('NOOO')
        return memo + x
      })
      .single()
  } catch (ex) {
    e = ex
  }
  expect(e).not.toBe(null)
  expect(e.message).toBe('NOOO')
})

test('reduce without initial value errors pass through', async () => {
  const errs = []
  const res = await _([1, 2, 3])
    .map((x) => {
      throw Error(x + '')
    })
    .reduce((memo, x) => memo + x)
    .errors((err) => errs.push(err))
    .single()
  expect(res).toBeUndefined()
  expect(errs.length).toBe(3)
  expect(errs[2].message).toBe('3')
})

test('reduce errors pass through', async () => {
  const errs = []
  const res = await _([1, 2, 3])
    .map((x) => {
      throw Error(x + '')
    })
    .reduce((memo, x) => memo + x, 0)
    .errors((err) => errs.push(err))
    .single()
  expect(res).toEqual(0)
  expect(errs.length).toBe(3)
  expect(errs[2].message).toBe('3')
})

test('groupBy basics', async () => {
  const res = await _([{ a: 1, b: 1 }, { a: 1, b: 2 }, { a: 2 }])
    .groupBy('a')
    .single()

  expect(res).toEqual({
    1: [
      { a: 1, b: 1 },
      { a: 1, b: 2 },
    ],
    2: [{ a: 2 }],
  })
})

test('groupBy nested', async () => {
  const res = await _([
    { a: { c: 3 }, b: 1 },
    { a: { c: 3 }, b: 2 },
    { a: null },
    { a: { c: null } },
  ])
    .groupBy('a.c')
    .single()

  expect(res).toEqual({
    3: [
      { a: { c: 3 }, b: 1 },
      { a: { c: 3 }, b: 2 },
    ],
    [_.nil]: [{ a: null }, { a: { c: null } }],
  })
})

test('groupBy function', async () => {
  const res = await _([{ a: { c: 3 }, b: 1 }, { a: { c: 3 }, b: 2 }, { a: null }])
    .groupBy((x) => (x.a && x.a.c) || 'null')
    .single()

  expect(res).toEqual({
    3: [
      { a: { c: 3 }, b: 1 },
      { a: { c: 3 }, b: 2 },
    ],
    null: [{ a: null }],
  })
})