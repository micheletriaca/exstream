const _ = require('../src/index.js')
const h = require('./helpers')

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

const incrementAsync = ({ begin, end }) => _(async (push, next) => {
  console.log({ begin, end })
  await h.sleep(1)
  const current = begin + 1
  if (current < end) {
    push(current)
    next(incrementAsync({ begin: current, end }))
  } else {
    push(current)
    push(_.nil)
  }
})

test('iterate', async () => {
  const values = await _(increment({ begin: 0, end: 10 }))
    .tap(console.log)
    .toPromise()
  expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('iterateAsync', async () => {
  const values = await _(incrementAsync({ begin: 0, end: 10 }))
    .tap(console.log)
    .on('end', () => console.log('ended'))
    .toPromise()
  expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('iteratePassingStream', async () => {
  const values = await _((push, next) => {
    push(1)
    next(_([1, 2, 3]))
  }).values()
  expect(values).toEqual([1, 1, 2, 3])
})

test('iteratePassingGenerator', async () => {
  const gen = x => (push, next) => {
    if (x < 5) {
      push(x)
      next(gen(x + 1))
    } else {
      push(_.nil)
    }
  }

  const values = await _(gen(0)).values()
  expect(values).toEqual([0, 1, 2, 3, 4])
})
