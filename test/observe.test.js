const _ = require('../src')
const h = require('./helpers')

test('observe basics', done => {
  const observedValues = []
  const s = _([1, 2, 3])
  const toArrayDone = jest.fn()
  s.observe().map(x => x * 2).pipe(h.getSlowWritable(observedValues, 50, 0)).on('finish', () => {
    done()
    expect(toArrayDone).toHaveBeenCalledTimes(1)
    expect(observedValues).toEqual([2, 4, 6])
  })

  expect(observedValues).toEqual([])

  s.toArray(res => {
    toArrayDone()
    // no back pressure on observers. so s ends while s.observe() buffers data
    expect(observedValues).toEqual([])
    expect(res).toEqual([1, 2, 3])
  })
})

test('observe basics - synchronous. even if it seems not so useful', () => {
  const s = _([1, 2, 3])
  const observer = s.observe().map(x => x * 2)

  const res = s.values()
  expect(res).toEqual([1, 2, 3])

  const observedValues = observer.values()
  expect(observedValues).toEqual([2, 4, 6])
})
