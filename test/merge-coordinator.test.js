vi.setConfig({ testTimeout: 3000 })

const _ = require('../src/index.js')
const { deferred, nextTurn, waitFor } = require('./invariant-helpers.js')
const { kAbort, kDestroy, kResume } = require('../src/stream-control.js')

test.each([false, true])(
  'merge is lazy before a terminal starts it (ordered: %s)',
  async (ordered) => {
    let started = 0
    const inner = _({
      [Symbol.iterator]() {
        started++
        return [][Symbol.iterator]()
      },
    })
    const merged = _([inner]).merge(1, ordered)

    await nextTurn()
    const startedBeforeTerminal = started
    await merged.drain()

    expect(startedBeforeTerminal).toBe(0)
    expect(started).toBe(1)
  },
)

test.each([false, true])(
  'merge activates deferred sources lazily and within its activation window (ordered: %s)',
  async (ordered) => {
    const releases = [deferred(), deferred(), deferred()]
    const invoked = []
    const inners = releases.map((release, index) =>
      _.defer(() => {
        invoked.push(index)
        return (async function* () {
          await release.promise
          yield index
        })()
      }),
    )
    const merged = _(inners).merge(2, ordered)

    await nextTurn()
    expect(invoked).toEqual([])

    const completion = merged.toArray()
    await waitFor(() => invoked.length === 2, 'merge did not acquire its initial source window')
    expect(invoked).toEqual([0, 1])

    releases[0].resolve()
    await waitFor(() => invoked.length === 3, 'merge did not acquire the next deferred source')
    releases[1].resolve()
    releases[2].resolve()

    const result = await completion
    expect(result.toSorted()).toEqual([0, 1, 2])
    if (ordered) expect(result).toEqual([0, 1, 2])
  },
)

test('merge accepts direct and deferred streams in the same outer stream', async () => {
  await expect(
    _([_([1]), _.defer(() => [2])])
      .merge(2, true)
      .toArray(),
  ).resolves.toEqual([1, 2])
})

test('merge rejects function values without invoking them', async () => {
  const value = vi.fn(() => _([1]))
  const errors = []

  await _([value])
    .merge()
    .errors((error) => errors.push(error))
    .drain()

  expect(value).not.toHaveBeenCalled()
  expect(errors).toHaveLength(1)
  expect(errors[0].message).toBe('.merge() can merge ONLY exstream instances')
})

test('a failing deferred source becomes a source error and releases its merge slot', async () => {
  const reason = Error('source acquisition failed')
  const errors = []
  const result = await _([
    _.defer(() => {
      throw reason
    }),
    _.defer(() => [2]),
  ])
    .merge(1, true)
    .errors((error) => errors.push(error))
    .toArray()

  expect(result).toEqual([2])
  expect(errors).toEqual([reason])
  expect(_.errorInfo(reason)).toMatchObject({ origin: 'source', stage: 'defer' })
})

test('destroying merge does not acquire deferred sources still outside the window', async () => {
  const release = deferred()
  const invoked = []
  const inners = [
    _.defer(() => {
      invoked.push(0)
      return (async function* () {
        await release.promise
        yield 0
      })()
    }),
    _.defer(() => {
      invoked.push(1)
      return [1]
    }),
  ]
  const merged = _(inners).merge(1)
  const completion = merged.drain()

  await waitFor(() => invoked.length === 1, 'merge did not acquire the first deferred source')
  merged[kDestroy]()
  await nextTurn()

  expect(invoked).toEqual([0])
  expect(inners[0].state).toBe('destroyed')
  expect(inners[1].state).toBe('idle')
  release.resolve()
  await completion.catch(() => {})
})

test('ordered merge streams the current inner before it ends', async () => {
  const release = deferred()
  const produced = []
  const emitted = []
  const inner = _(
    (async function* () {
      produced.push(1)
      yield 1
      await release.promise
      produced.push(2)
      yield 2
    })(),
  )
  const completion = _([inner])
    .merge(1, true)
    .tap((value) => emitted.push(value))
    .toArray()

  await waitFor(() => produced.length === 1, 'the inner stream did not start')
  await nextTurn()
  const emittedBeforeEnd = [...emitted]
  release.resolve()

  await expect(completion).resolves.toEqual([1, 2])
  expect(emittedBeforeEnd).toEqual([1])
})

test('an ordered buffered inner becomes streaming as soon as it reaches the head', async () => {
  const finishFirst = deferred()
  const finishSecond = deferred()
  const produced = []
  const emitted = []
  const first = _(
    (async function* () {
      produced.push('first')
      yield 'first'
      await finishFirst.promise
    })(),
  )
  const second = _(
    (async function* () {
      produced.push('second-1')
      yield 'second-1'
      await finishSecond.promise
      produced.push('second-2')
      yield 'second-2'
    })(),
  )
  const completion = _([first, second])
    .merge(2, true)
    .tap((value) => emitted.push(value))
    .toArray()

  await waitFor(() => produced.length === 2, 'both inner streams did not start')
  await nextTurn()
  const emittedWhileFirstWasOpen = [...emitted]

  finishFirst.resolve()
  await waitFor(() => emitted.includes('second-1'), 'the second inner did not become streaming')
  const emittedWhileSecondWasOpen = [...emitted]
  finishSecond.resolve()

  await expect(completion).resolves.toEqual(['first', 'second-1', 'second-2'])
  expect(emittedWhileFirstWasOpen).toEqual(['first'])
  expect(emittedWhileSecondWasOpen).toEqual(['first', 'second-1'])
})

test('ordered merge consumes future inners eagerly without exceeding its stream window', async () => {
  const finishFirst = deferred()
  const started = []
  const completed = []
  const emitted = []
  const first = _(
    (async function* () {
      started.push('first')
      yield 'first'
      await finishFirst.promise
      completed.push('first')
    })(),
  )
  const second = _(
    (function* () {
      started.push('second')
      yield 'second-1'
      yield 'second-2'
      completed.push('second')
    })(),
  )
  const third = _(
    (function* () {
      started.push('third')
      yield 'third'
      completed.push('third')
    })(),
  )
  const completion = _([first, second, third])
    .merge(2, true)
    .tap((value) => emitted.push(value))
    .toArray()

  await waitFor(() => completed.includes('second'), 'the buffered inner was not consumed eagerly')
  await waitFor(() => emitted.includes('first'), 'the head inner did not begin streaming')
  expect(started).toEqual(['first', 'second'])
  expect(emitted).toEqual(['first'])

  finishFirst.resolve()
  await waitFor(() => started.includes('third'), 'the ordered window did not release one slot')

  await expect(completion).resolves.toEqual(['first', 'second-1', 'second-2', 'third'])
  expect(completed).toEqual(['second', 'first', 'third'])
})

test('ordered merge preserves data, record errors, contexts, and their relative order', async () => {
  const reason = Error('recoverable inner failure')
  const events = []
  const inner = _([1, 2, 3])
    .withContext((value) => ({ source: 'inner', sourceValue: value }))
    .map((value) => {
      if (value === 2) throw reason
      return value
    })

  await _([inner])
    .merge(1, true)
    .errors((error, _push, context) => {
      events.push({ context, error, type: 'error' })
    })
    .tap((value, context) => {
      events.push({ context, type: 'data', value })
    })
    .drain()

  expect(events).toEqual([
    {
      context: expect.objectContaining({ input: 1, source: 'inner', sourceValue: 1 }),
      type: 'data',
      value: 1,
    },
    {
      context: expect.objectContaining({ input: 2, source: 'inner', sourceValue: 2 }),
      error: reason,
      type: 'error',
    },
    {
      context: expect.objectContaining({ input: 3, source: 'inner', sourceValue: 3 }),
      type: 'data',
      value: 3,
    },
  ])
})

test('ordered merge replays buffered record errors in their original position', async () => {
  const finishFirst = deferred()
  const reason = Error('buffered inner failure')
  const events = []
  const first = _(
    (async function* () {
      yield 'first'
      await finishFirst.promise
    })(),
  )
  const second = _([1, 2, 3])
    .withContext((value) => ({ source: 'second', sourceValue: value }))
    .map((value) => {
      if (value === 2) throw reason
      return value
    })
  const completion = _([first, second])
    .merge(2, true)
    .errors((error, _push, context) => events.push({ context, error, type: 'error' }))
    .tap((value, context) => events.push({ context, type: 'data', value }))
    .drain()

  await waitFor(() => second.ended, 'the future inner was not consumed eagerly')
  expect(events).toEqual([
    {
      context: expect.objectContaining({ input: 'first' }),
      type: 'data',
      value: 'first',
    },
  ])
  finishFirst.resolve()
  await completion

  expect(events).toEqual([
    {
      context: expect.objectContaining({ input: 'first' }),
      type: 'data',
      value: 'first',
    },
    {
      context: expect.objectContaining({ input: 1, source: 'second', sourceValue: 1 }),
      type: 'data',
      value: 1,
    },
    {
      context: expect.objectContaining({ input: 2, source: 'second', sourceValue: 2 }),
      error: reason,
      type: 'error',
    },
    {
      context: expect.objectContaining({ input: 3, source: 'second', sourceValue: 3 }),
      type: 'data',
      value: 3,
    },
  ])
})

test('ordered merge never reclassifies an Error data value', async () => {
  const value = Error('business value')
  const errors = []

  const result = await _([_([_.data(value)])])
    .merge(1, true)
    .errors((error) => errors.push(error))
    .toArray()

  expect(result).toEqual([value])
  expect(errors).toEqual([])
})

test('an inner that cannot accept a consumer becomes a record error without blocking the window', async () => {
  const unavailable = _([1])
  const reservedConsumer = unavailable.map((value) => value)
  const errors = []

  const result = await _([unavailable, _([2])])
    .merge(1, false)
    .errors((error) => errors.push(error))
    .toArray()
  reservedConsumer[kDestroy]()

  expect(result).toEqual([2])
  expect(errors).toHaveLength(1)
  expect(errors[0].message).toContain('already been transformed or consumed')
})

test('an ordered record error neither completes its inner nor releases its concurrency slot', async () => {
  const releaseFirst = deferred()
  const reason = Error('recoverable but not complete')
  const errors = []
  let active = 0
  let firstStarted = 0
  let maxActive = 0
  let secondStarted = 0
  const first = _(
    (async function* () {
      firstStarted++
      active++
      maxActive = Math.max(maxActive, active)
      yield reason
      await releaseFirst.promise
      yield 'first'
      active--
    })(),
  )
  const second = _(
    (async function* () {
      secondStarted++
      active++
      maxActive = Math.max(maxActive, active)
      yield 'second'
      active--
    })(),
  )
  const completion = _([first, second])
    .merge(1, true)
    .errors((error) => errors.push(error))
    .toArray()

  await waitFor(() => errors.length === 1, 'the record error was not emitted')
  await nextTurn()
  const secondStartedBeforeFirstEnded = secondStarted
  releaseFirst.resolve()

  await expect(completion).resolves.toEqual(['first', 'second'])
  expect(errors).toEqual([reason])
  expect(firstStarted).toBe(1)
  expect(secondStartedBeforeFirstEnded).toBe(0)
  expect(maxActive).toBe(1)
})

test('destroying an ordered merge destroys every active inner', async () => {
  const releases = [deferred(), deferred()]
  let started = 0
  const inners = releases.map((release, index) =>
    _(
      (async function* () {
        started++
        await release.promise
        yield index
      })(),
    ),
  )
  const merged = _(inners).merge(2, true)
  const completion = merged.drain()

  await waitFor(() => started === 2, 'the ordered merge did not activate both inners')
  merged[kDestroy]()
  await nextTurn()
  await nextTurn()
  const statesAfterDestroy = inners.map((inner) => inner.state)
  for (const release of releases) release.resolve()
  await completion.catch(() => {})

  expect(statesAfterDestroy).toEqual(['destroyed', 'destroyed'])
})

test.each([false, true])(
  'aborting one inner aborts the whole merge (ordered: %s)',
  async (ordered) => {
    const reason = Error('inner aborted')
    const first = _()
    const second = _()
    const merged = _([first, second]).merge(2, ordered)
    const completion = merged.toArray()

    await waitFor(
      () => first.state === 'running' && second.state === 'running',
      'the merge did not activate both inners',
    )
    first[kAbort](reason)

    await expect(completion).rejects.toBe(reason)
    expect(merged.state).toBe('aborted')
    expect(second.state).toBe('aborted')
    expect(second.abortReason).toBe(reason)
  },
)

test('unordered merge preserves the context of outer record errors', async () => {
  const contexts = []
  const outer = _([1])
    .withContext(() => ({ source: 'outer' }))
    .map(() => {
      throw Error('outer failure')
    })

  await outer
    .merge(1, false)
    .errors((_error, _push, context) => contexts.push(context))
    .drain()

  expect(contexts).toEqual([expect.objectContaining({ input: 1, source: 'outer' })])
})

test('ordered merge emits outer record errors in outer order with their context', async () => {
  const reason = Error('outer failure')
  const events = []
  const entries = [
    { index: 0, stream: _(['first']) },
    { index: 1 },
    { index: 2, stream: _(['third']) },
  ]
  const outer = _(entries)
    .withContext((entry) => ({ outerIndex: entry.index }))
    .map((entry) => {
      if (!entry.stream) throw reason
      return entry.stream
    })

  await outer
    .merge(2, true)
    .errors((error, _push, context) => events.push({ context, error, type: 'error' }))
    .tap((value) => events.push({ type: 'data', value }))
    .drain()

  expect(events).toEqual([
    { type: 'data', value: 'first' },
    {
      context: expect.objectContaining({ outerIndex: 1 }),
      error: reason,
      type: 'error',
    },
    { type: 'data', value: 'third' },
  ])
})

test('outer record errors obey unordered downstream backpressure', async () => {
  let transformed = 0
  let received = 0
  const outer = _(Array.from({ length: 20 }, (_, index) => index)).map((value) => {
    transformed++
    throw Error(`outer failure ${value}`)
  })
  const merged = outer.merge(1, false)
  const sink = merged.consume((error, value, push) => {
    if (value === _.nil) push(null, _.nil)
    else if (error) received++
  })
  sink[kResume]()

  await waitFor(() => received === 1, 'the first outer error did not reach the consumer')
  for (let turn = 0; turn < 10; turn++) await nextTurn()
  const transformedWhileBlocked = transformed
  merged[kDestroy]()
  await nextTurn()

  expect(transformedWhileBlocked).toBe(2)
})