vi.setConfig({ testTimeout: 2000 })

const _ = require('../src/index.js')
const { deferred, waitFor } = require('./invariant-helpers.js')

test('resolve(n) never runs more than n promises concurrently', async () => {
  const parallelism = 3
  const values = Array.from({ length: 12 }, (_, index) => index)
  const releases = []
  let active = 0
  let maxActive = 0

  const resultPromise = _(values)
    .map(
      (value) =>
        new Promise((resolve) => {
          active++
          maxActive = Math.max(maxActive, active)
          releases.push(() => {
            active--
            resolve(value)
          })
        }),
    )
    .resolve(parallelism, false)
    .toPromise()

  await waitFor(
    () => releases.length >= parallelism,
    'resolve() did not start the initial promise window',
  )
  expect(releases).toHaveLength(parallelism)
  expect(active).toBe(parallelism)

  for (let index = 0; index < values.length; index++) {
    await waitFor(() => releases.length > index, `promise ${index} was not started`)
    expect(active).toBeLessThanOrEqual(parallelism)
    releases[index]()
  }

  const result = await resultPromise
  expect(maxActive).toBe(parallelism)
  expect([...result].sort((a, b) => a - b)).toEqual(values)
})

test('merge(n) never activates more than n source streams concurrently', async () => {
  const parallelism = 3
  const values = Array.from({ length: 12 }, (_, index) => index)
  const releases = []
  let active = 0
  let maxActive = 0

  const streams = values.map((value) =>
    _(async (write) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => releases.push(resolve))
      active--
      write(value)
      write(_.nil)
    }),
  )
  const resultPromise = _(streams).merge(parallelism, false).toPromise()

  await waitFor(
    () => releases.length >= parallelism,
    'merge() did not start the initial stream window',
  )
  expect(releases).toHaveLength(parallelism)
  expect(active).toBe(parallelism)

  for (let index = 0; index < values.length; index++) {
    await waitFor(() => releases.length > index, `stream ${index} was not activated`)
    expect(active).toBeLessThanOrEqual(parallelism)
    releases[index]()
  }

  const result = await resultPromise
  expect(maxActive).toBe(parallelism)
  expect([...result].sort((a, b) => a - b)).toEqual(values)
})

test('resolve preserves input order only when requested', async () => {
  const values = [0, 1, 2, 3, 4]
  const orderedGates = values.map(() => deferred())
  const unorderedGates = values.map(() => deferred())
  const orderedStarted = []
  const unorderedStarted = []
  const unorderedEmitted = []

  const orderedResult = _(values)
    .map((value) => {
      orderedStarted.push(value)
      return orderedGates[value].promise.then(() => value)
    })
    .resolve(3, true)
    .toPromise()
  const unorderedResult = _(values)
    .map((value) => {
      unorderedStarted.push(value)
      return unorderedGates[value].promise.then(() => value)
    })
    .resolve(3, false)
    .tap((value) => unorderedEmitted.push(value))
    .toPromise()

  await waitFor(() => orderedStarted.length === 3 && unorderedStarted.length === 3)

  for (const value of [2, 1, 0]) {
    orderedGates[value].resolve()
    unorderedGates[value].resolve()
    await waitFor(() => unorderedEmitted.length === 3 - value)
  }

  await waitFor(() => orderedStarted.length === 5 && unorderedStarted.length === 5)
  for (const value of [4, 3]) {
    orderedGates[value].resolve()
    unorderedGates[value].resolve()
    await waitFor(() => unorderedEmitted.length === 8 - value)
  }

  expect(await orderedResult).toEqual(values)
  expect(await unorderedResult).toEqual([2, 1, 0, 4, 3])
})

test('ordered merge activates n streams but emits each complete stream in input order', async () => {
  const firstGate = deferred()
  const secondGate = deferred()
  const completed = []
  const emitted = []
  let active = 0

  const controlledStream = (name, gate) =>
    _(async (write) => {
      active++
      await gate.promise
      write(`${name}-1`)
      write(`${name}-2`)
      completed.push(name)
      write(_.nil)
    })
  const resultPromise = _([
    controlledStream('first', firstGate),
    controlledStream('second', secondGate),
  ])
    .merge(2, true)
    .tap((value) => emitted.push(value))
    .toPromise()

  await waitFor(() => active === 2, 'ordered merge did not activate both streams')
  secondGate.resolve()
  await waitFor(() => completed.includes('second'), 'second stream did not complete')
  expect(emitted).toEqual([])

  firstGate.resolve()
  expect(await resultPromise).toEqual(['first-1', 'first-2', 'second-1', 'second-2'])
})