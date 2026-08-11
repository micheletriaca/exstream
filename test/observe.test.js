const _ = require('../src')
const h = require('./helpers')

test('observe basics', async () => {
  const observedValues = []
  const s = _([1, 2, 3])
  const toArrayDone = vi.fn()
  const observerDone = new Promise((resolve) => {
    s.observe()
      .map((x) => x * 2)
      .pipe(h.getSlowWritable(observedValues, 50, 0))
      .on('finish', resolve)
  })

  expect(observedValues).toEqual([])

  const sourceResult = await new Promise((resolve) => {
    s.toArray((res) => {
      toArrayDone()
      resolve({ observedValues: [...observedValues], res })
    })
  })

  // no back pressure on observers. so s ends while s.observe() buffers data
  expect(sourceResult.observedValues).toEqual([])
  expect(sourceResult.res).toEqual([1, 2, 3])

  await observerDone
  expect(toArrayDone).toHaveBeenCalledTimes(1)
  expect(observedValues).toEqual([2, 4, 6])
})

test('observe basics - synchronous. even if it seems not so useful', () => {
  const s = _([1, 2, 3])
  const observer = s.observe().map((x) => x * 2)

  const res = s.values()
  expect(res).toEqual([1, 2, 3])

  const observedValues = observer.values()
  expect(observedValues).toEqual([2, 4, 6])
})