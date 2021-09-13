const __ = require('../src/index.js')

const increment = ({ begin, end }) => (push, next) => {
  console.log({ begin, end })
  const current = begin + 1
  if (current <= end) {
    push(current)
    return next(increment({ begin: current, end }))
  }
  push(current)
  return push(__.nil)
}

test('iterate', async () => {
  const values = await __(increment({ begin: 0, end: 10 }))
    .tap(console.log())
    .toPromise()
  expect(values).toEqual([])
})
