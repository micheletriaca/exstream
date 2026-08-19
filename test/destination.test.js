const _ = require('../src/index.js')
const { waitFor } = require('./invariant-helpers.js')

test('pipeline drain creates a lazy reusable destination', async () => {
  const seen = []
  const destination = _.pipeline()
    .map((value) => value * 2)
    .tap((value) => seen.push(value))
    .drain()

  expect(destination.__exstream_destination__).toBe(true)
  expect(seen).toEqual([])

  await _([1, 2]).pipeTo(destination)
  await _([3]).pipeTo(destination)

  expect(seen).toEqual([2, 4, 6])
})

test('pipeline destinations batch records and keep mapAsync concurrency bounded', async () => {
  const batches = []
  let active = 0
  let peakActive = 0
  const release = []
  const destination = _.pipeline()
    .batch(2)
    .mapAsync(
      async (batch) => {
        active++
        peakActive = Math.max(peakActive, active)
        await new Promise((resolve) => release.push(resolve))
        batches.push(batch)
        active--
      },
      { concurrency: 2, ordered: false },
    )
    .drain()

  const completion = _([1, 2, 3, 4, 5]).pipeTo(destination)
  await waitFor(() => release.length === 2, 'destination did not fill its async window')
  expect(active).toBe(2)
  release.shift()()
  await waitFor(() => release.length === 2, 'destination did not admit the final batch')
  while (release.length) release.shift()()
  await completion

  expect(peakActive).toBe(2)
  expect(batches).toEqual(expect.arrayContaining([[1, 2], [3, 4], [5]]))
})

test('pipeline drain snapshots its operator definition', async () => {
  const original = vi.fn()
  const addedLater = vi.fn()
  const pipeline = _.pipeline().tap(original)
  const destination = pipeline.drain()
  pipeline.tap(addedLater)

  await _([1]).pipeTo(destination)

  expect(original).toHaveBeenCalledOnce()
  expect(addedLater).not.toHaveBeenCalled()
})

test('destination provides a high-level reusable lifecycle boundary', async () => {
  const events = []
  const destination = _.destination(async (source, { signal }) => {
    events.push(['open', signal.aborted])
    try {
      await source.tap((value) => events.push(['write', value])).drain()
    } finally {
      events.push(['close', signal.aborted])
    }
  })

  await _([1, 2]).pipeTo(destination)
  await _([3]).pipeTo(destination)

  expect(events).toEqual([
    ['open', false],
    ['write', 1],
    ['write', 2],
    ['close', false],
    ['open', false],
    ['write', 3],
    ['close', false],
  ])
})

test('a destination operator failure rejects pipeTo with its original provenance', async () => {
  const reason = Error('bulk request failed')
  const source = _([1, 2, 3])
  const destination = _.pipeline()
    .batch(2)
    .mapAsync(() => {
      throw reason
    })
    .drain()

  await expect(source.pipeTo(destination)).rejects.toBe(reason)

  expect(source.state).toBe('aborted')
  expect(_.errorInfo(reason)).toMatchObject({
    input: [1, 2],
    origin: 'operator',
    stage: 'mapAsync',
  })
})

test('a custom destination failure is classified as a sink failure', async () => {
  const reason = Error('database unavailable')
  const source = _([1, 2])
  const destination = _.destination(async () => {
    throw reason
  })

  await expect(source.pipeTo(destination)).rejects.toBe(reason)

  expect(source.state).toBe('aborted')
  expect(_.errorInfo(reason)).toMatchObject({ origin: 'sink', stage: 'destination' })
})

test('a destination cannot turn an aborted source into successful completion', async () => {
  const reason = Error('source failed')
  const destination = _.destination(async (source) => {
    await source.drain().catch(() => undefined)
  })

  await expect(
    _([1])
      .map(() => {
        throw reason
      })
      .pipeTo(destination),
  ).rejects.toBe(reason)

  expect(_.errorInfo(reason)).toMatchObject({ origin: 'operator', stage: 'map' })
})

test('a destination may intentionally stop after consuming part of its source', async () => {
  const seen = []
  const destination = _.pipeline()
    .take(1)
    .tap((value) => seen.push(value))
    .drain()

  await expect(_([1, 2, 3]).pipeTo(destination)).resolves.toBeUndefined()

  expect(seen).toEqual([1])
})

test('an external signal aborts a destination and its source branch', async () => {
  const controller = new AbortController()
  const reason = Error('stop importing')
  const source = _(null)
  let destinationSignal
  let cleanedUp = false
  const destination = _.destination(async (input, context) => {
    destinationSignal = context.signal
    try {
      await Promise.all([
        input.drain(),
        new Promise((resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), {
            once: true,
          })
        }),
      ])
    } finally {
      cleanedUp = true
    }
  })

  const completion = source.pipeTo(destination, { signal: controller.signal })
  controller.abort(reason)

  await expect(completion).rejects.toBe(reason)
  expect(source.state).toBe('aborted')
  expect(destinationSignal.aborted).toBe(true)
  expect(destinationSignal.reason).toBe(reason)
  expect(cleanedUp).toBe(true)
  expect(_.errorInfo(reason)).toMatchObject({ origin: 'lifecycle', stage: 'abort' })
})

test('a pre-aborted signal does not start a destination', async () => {
  const controller = new AbortController()
  const reason = Error('already stopped')
  const run = vi.fn(async (source) => source.drain())
  const destination = _.destination(run)
  controller.abort(reason)

  await expect(_([1]).pipeTo(destination, { signal: controller.signal })).rejects.toBe(reason)

  expect(run).not.toHaveBeenCalled()
})

test('destination rejects definitions that cannot report completion', async () => {
  expect(() => _.destination(null)).toThrow('run must be a function')

  const source = _([1])
  const destination = _.destination(() => undefined)
  await expect(source.pipeTo(destination)).rejects.toMatchObject({
    code: 'EXSTREAM_DESTINATION_NO_PROMISE',
    exstreamInfo: { origin: 'sink', stage: 'destination' },
  })
  expect(source.state).toBe('aborted')
})

test('destination rejects a run that completes without consuming its source', async () => {
  const source = _([1])
  const destination = _.destination(async () => {})

  await expect(source.pipeTo(destination)).rejects.toMatchObject({
    code: 'EXSTREAM_DESTINATION_INCOMPLETE',
    exstreamInfo: { origin: 'sink', stage: 'destination' },
  })
  expect(source.state).toBe('aborted')
})