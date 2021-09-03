const _ = require('../src/index.js')
const h = require('./helpers.js')

test('reduce', () => {
  const res = _([1, 2, 3])
    .reduce((memo, x) => memo + x, 0)
    .value()
  expect(res).toEqual(6)
})

test('reduce1 - sum', () => {
  const res = _([1, 2, 3])
    .reduce1((memo, x) => memo + x)
    .value()
  expect(res).toEqual(6)
})

test('reduce1 - to object', () => {
  const res = _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .reduce1((memo, x) => ({ ...memo, ...x }))
    .value()
  expect(res).toEqual({ a: 2, b: 1 })
})

test('reduce from empty list', () => {
  const res = _([])
    .reduce((memo, x) => memo + x, 0)
    .value()
  expect(res).toEqual(0)
})

test('reduce1 from empty list', () => {
  const res = _([])
    .reduce1((memo, x) => memo + x)
    .value()
  expect(res).toEqual(undefined)
})

test('reduce1 after pluck', () => {
  const res = _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .pluck('a')
    .compact()
    .reduce1((memo, x) => memo + x)
    .value()
  expect(res).toEqual(3)
})

test('reduce after pluck', () => {
  const res = _([{ a: 1 }, { a: 2 }, { b: 1 }])
    .pluck('a')
    .reduce((memo, x) => memo + x, 0)
    .value()
  expect(res).toEqual(NaN)
})

test('reduce1 in async chain', async () => {
  const res = await _([1, 2, 3])
    .map(async x => {
      await h.sleep(10)
      return x
    })
    .resolve()
    .reduce1((memo, x) => memo + x)
    .toPromise()

  expect(res).toEqual([6])
})

test('async reduce', async () => {
  const res = await _([1, 2, 3])
    .asyncReduce(async (memo, x) => {
      await h.sleep(10)
      return memo + x
    }, 0)
    .toPromise()
  expect(res).toEqual([6])
})

test('reduce errors', async () => {
  let e
  try {
    _([1, 2, 3])
      .reduce((memo, x) => {
        if (x === 3) throw Error('NOOO')
        return memo + x
      }, 0)
      .value()
  } catch (ex) {
    e = ex
  }
  expect(e).not.toBe(null)
  expect(e.message).toBe('NOOO')
  // expect(res).toBe(undefined)
})

test('reduce errors - 2', async () => {
  let e
  const res = _([1, 2, 3])
    .reduce((memo, x) => {
      if (x === 3) throw Error('NOOO')
      return memo + x
    }, 0)
    .errors(ex => (e = ex))
    .value()
  expect(e).not.toBe(null)
  expect(e.message).toBe('NOOO')
  expect(res).toBe(undefined)
})

test('reduce1 errors', async () => {
  let e
  const res = _([1, 2, 3])
    .reduce1((memo, x) => {
      if (x === 3) throw Error('NOOO')
      return memo + x
    })
    .errors(ex => (e = ex))
    .value()
  expect(e).not.toBe(null)
  expect(e.message).toBe('NOOO')
  expect(res).toBe(undefined)
})

test('reduce1 errors - 2', async () => {
  let e
  try {
    _([1, 2, 3])
      .reduce1((memo, x) => {
        if (x === 3) throw Error('NOOO')
        return memo + x
      })
      .value()
  } catch (ex) {
    e = ex
  }
  expect(e).not.toBe(null)
  expect(e.message).toBe('NOOO')
})

test('reduce1 errors pass through', async () => {
  const errs = []
  const res = _([1, 2, 3])
    .map(x => { throw Error(x + '') })
    .reduce1((memo, x) => memo + x)
    .errors(err => errs.push(err))
    .value()
  expect(res).toEqual(undefined)
  expect(errs.length).toBe(3)
  expect(errs[2].message).toBe('3')
})

test('reduce errors pass through', async () => {
  const errs = []
  const res = _([1, 2, 3])
    .map(x => { throw Error(x + '') })
    .reduce((memo, x) => memo + x, 0)
    .errors(err => errs.push(err))
    .value()
  expect(res).toEqual(0)
  expect(errs.length).toBe(3)
  expect(errs[2].message).toBe('3')
})

test('async reduce errors', async () => {
  const errs = []
  const res = await _([1, 2, 3])
    .asyncReduce(async (memo, x) => {
      if (x === 3) throw Error('NOOO')
      return memo + x
    }, 0)
    .toPromise()
    .catch(e => {
      errs.push(e)
      return undefined
    })
  expect(res).toEqual(undefined)
  expect(errs.length).toBe(1)
  expect(errs[0].message).toBe('NOOO')
})

test('async reduce errors pass through', async () => {
  const errs = []
  const res = await _([1, 2, 3])
    .map(x => { throw Error(x + '') })
    .asyncReduce(async (memo, x) => memo + x, 0)
    .errors(x => errs.push(x))
    .toPromise()
  expect(res).toEqual([0])
  expect(errs.length).toBe(3)
  expect(errs[2].message).toBe('3')
})
