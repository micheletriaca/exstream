const _ = require('../src/index.js')

const increment = ({ begin, end }) => _((push, next) => {
  console.log({ begin, end })
  const current = begin + 1
  if (current < end) {
    push(current)
    return next(increment({ begin: current, end }))
  }
  push(current)
  return push(_.nil)
})

test('iterate', async () => {
  const values = await _(increment({ begin: 0, end: 10 }))
    .tap(console.log)
    .toPromise()
  expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})
