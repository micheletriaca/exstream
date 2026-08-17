const _ = require('../src/index.js')
const h = require('./helpers.js')

test('pipeTo rejects an unhandled error', async () => {
  const res = []
  await expect(
    _([1, 2, 3])
      .map((i) => {
        if (i > 1) throw Error('NOO')
        return i
      })
      .pipeTo(h.getSlowWritable(res, 0, 10)),
  ).rejects.toThrow('NOO')
  expect(res).toEqual([1])
})

test('pipeTo succeeds when pipeline errors are handled', async () => {
  const res = []
  const errs = []

  const p = _.pipeline()
    .map((x) => x)
    .map(() => {
      throw Error('NOO')
    })

  await _([1, 2, 3])
    .through(p.generateStream())
    .errors((e) => errs.push(e))
    .pipeTo(h.getSlowWritable(res, 0, 10))
  expect(res).toEqual([])
  expect(errs.length).toBe(3)
  expect(errs[2].message).toBe('NOO')
})

test('piping an error after promise', async () => {
  const res = []
  const result = _([1])
    .map(async (x) => x)
    .resolve()
    .map(() => {
      throw Error('an error')
    })
    .pipeTo(h.getSlowWritable(res))

  await expect(result).rejects.toThrow('an error')
})

test('pipeTo rejects an error after an asynchronous stage', async () => {
  const res = []
  const result = _([1])
    .map(async (x) => x)
    .resolve()
    .map(() => {
      throw Error('an error')
    })
    .pipeTo(h.getSlowWritable(res))
  await expect(result).rejects.toThrow('an error')
})