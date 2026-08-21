const exstream = require('../src/index.js')
const { deferred, nextTurn, waitFor } = require('./invariant-helpers.js')

test.each(['left', 'right'])(
  'sortedJoin propagates a fatal failure from the %s input',
  async (side) => {
    const reason = Error(`fatal ${side} input`)
    const failing = exstream([{ id: 1 }, { id: 2 }])
      .map((value) => {
        if (value.id === 2) throw reason
        return value
      })
      .failOnError()
    const healthy = exstream([{ id: 1 }])
    const left = side === 'left' ? failing : healthy
    const right = side === 'right' ? failing : healthy

    const result = left.sortedJoin(right, { leftKey: 'id', rightKey: 'id' }).toArray()

    await expect(result).rejects.toBe(reason)
  },
)

test('sortedJoin uses a custom comparator to determine key equivalence', async () => {
  const left = exstream([{ id: 'A' }])
  const right = exstream([{ id: 'a' }])

  const result = await left
    .sortedJoin(right, {
      leftKey: 'id',
      order: (leftKey, rightKey) =>
        leftKey.localeCompare(rightKey, undefined, { sensitivity: 'base' }),
      rightKey: 'id',
    })
    .toArray()

  expect(result).toEqual([
    {
      key: 'A',
      left: { id: 'A' },
      right: { id: 'a' },
    },
  ])
})

test('sortedJoin follows descending input order', async () => {
  const left = exstream([{ id: 3 }, { id: 2 }, { id: 1 }])
  const right = exstream([{ ownerId: 3 }, { ownerId: 1 }])

  const result = await left
    .sortedJoin(right, {
      leftKey: 'id',
      order: 'desc',
      rightKey: 'ownerId',
      type: 'left',
    })
    .toArray()

  expect(result).toEqual([
    { key: 3, left: { id: 3 }, right: { ownerId: 3 } },
    { key: 2, left: { id: 2 }, right: null },
    { key: 1, left: { id: 1 }, right: { ownerId: 1 } },
  ])
})

test('sortedJoin rejects a non-numeric comparator result', async () => {
  const joined = exstream([{ id: 1 }]).sortedJoin(exstream([{ id: 1 }]), {
    leftKey: 'id',
    order: () => true,
    rightKey: 'id',
  })

  await expect(joined.toArray()).rejects.toThrow(
    'error in .sortedJoin(). the order comparator must return a number',
  )
})

test('sortedJoin emits duplicate products under downstream demand', async () => {
  let rightReads = 0
  function* rightValues() {
    rightReads++
    yield { id: 1 }
    rightReads++
    yield { id: 2 }
  }
  const left = exstream(Array.from({ length: 100 }, (_, index) => ({ id: 1, index })))
  const right = exstream(rightValues())
  const joined = left.sortedJoin(right, { leftKey: 'id', rightKey: 'id' })
  const iterator = joined[Symbol.asyncIterator]()

  await expect(iterator.next()).resolves.toEqual({
    done: false,
    value: { key: 1, left: { id: 1, index: 0 }, right: { id: 1 } },
  })
  expect(rightReads).toBe(1)
  expect(joined.buffered).toBe(0)

  await iterator.return()
  expect(right.state).toBe('destroyed')
})

test('cancelling a pending sortedJoin releases both inputs', async () => {
  const leftStarted = deferred()
  const rightStarted = deferred()
  const never = new Promise(() => {})
  async function* input(started) {
    started.resolve()
    await never
    yield { id: 1 }
  }
  const left = exstream(input(leftStarted))
  const right = exstream(input(rightStarted))

  const iterator = left.sortedJoin(right, { leftKey: 'id', rightKey: 'id' })[Symbol.asyncIterator]()
  const pending = iterator.next()
  await Promise.all([leftStarted.promise, rightStarted.promise])

  await iterator.return()
  await expect(pending).resolves.toEqual({ done: true, value: undefined })
  await nextTurn()
  await waitFor(() => left.ended && right.ended)

  expect(left.state).toBe('destroyed')
  expect(right.state).toBe('destroyed')
})