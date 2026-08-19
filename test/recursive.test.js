const _ = require('../src/index.js')
const h = require('./helpers')

function* increment({ begin, end }) {
  const current = begin + 1
  yield current
  if (current < end) yield* increment({ begin: current, end })
}

async function* incrementAsync({ begin, end }) {
  await h.sleep(1)
  const current = begin + 1
  yield current
  if (current < end) yield* incrementAsync({ begin: current, end })
}

test('iterate', async () => {
  await expect(_(increment({ begin: 0, end: 10 })).toArray()).resolves.toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ])
})

test('iterateAsync', async () => {
  await expect(_(incrementAsync({ begin: 0, end: 10 })).toArray()).resolves.toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ])
})

test('yield delegates to another iterable', async () => {
  function* source() {
    yield 1
    yield* [1, 2, 3]
  }

  await expect(_(source()).toArray()).resolves.toEqual([1, 1, 2, 3])
})

test('recursive delegation remains pull-based', async () => {
  function* source(value) {
    if (value >= 5) return
    yield value
    yield* source(value + 1)
  }

  await expect(_(source(0)).toArray()).resolves.toEqual([0, 1, 2, 3, 4])
})

test('a recursive iterator can stop without a source handoff protocol', async () => {
  function* source(questions) {
    const value = questions.pop()
    if (value > 0) return
    yield value
    yield* source(questions)
  }

  await expect(_(source([-1, 2, -3, -5])).toArray()).resolves.toEqual([-5, -3])
})