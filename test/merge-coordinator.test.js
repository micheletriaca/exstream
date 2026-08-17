vi.setConfig({ testTimeout: 3000 })

const _ = require('../src/index.js')
const { deferred, nextTurn, waitFor } = require('./invariant-helpers.js')

test.each([false, true])(
  'merge is lazy before a terminal starts it (ordered: %s)',
  async (ordered) => {
    let started = 0
    const inner = _((write) => {
      started++
      write(_.nil)
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
  'merge invokes stream factories lazily and within its activation window (ordered: %s)',
  async (ordered) => {
    const releases = [deferred(), deferred(), deferred()]
    const invoked = []
    const factories = releases.map((release, index) => () => {
      invoked.push(index)
      return _(async (write) => {
        await release.promise
        write(index)
        write(_.nil)
      })
    })
    const merged = _(factories).merge(2, ordered)

    await nextTurn()
    expect(invoked).toEqual([])

    const completion = merged.toArray()
    await waitFor(() => invoked.length === 2, 'merge did not invoke its initial factory window')
    expect(invoked).toEqual([0, 1])

    releases[0].resolve()
    await waitFor(() => invoked.length === 3, 'merge did not invoke the next factory')
    releases[1].resolve()
    releases[2].resolve()

    const result = await completion
    expect(result.toSorted()).toEqual([0, 1, 2])
    if (ordered) expect(result).toEqual([0, 1, 2])
  },
)

test('merge accepts direct streams and stream factories in the same outer stream', async () => {
  await expect(
    _([_([1]), () => _([2])])
      .merge(2, true)
      .toArray(),
  ).resolves.toEqual([1, 2])
})

test('a throwing stream factory becomes a contextual record error and releases its slot', async () => {
  const reason = Error('factory failed')
  const errors = []
  const contexts = []
  const result = await _([
    () => {
      throw reason
    },
    () => _([2]),
  ])
    .withContext(() => ({ source: 'outer factory' }))
    .merge(1, true)
    .errors((error, _push, context) => {
      errors.push(error)
      contexts.push(context)
    })
    .toArray()

  expect(result).toEqual([2])
  expect(errors).toEqual([reason])
  expect(contexts).toEqual([expect.objectContaining({ source: 'outer factory' })])
})

test.each([
  ['a non-stream value', () => 42],
  ['a promise', async () => _([1])],
  ['a rejected promise', () => Promise.reject(Error('async factory failed'))],
])(
  'a factory returning %s becomes a record error and does not block merge',
  async (_name, factory) => {
    const errors = []
    const result = await _([factory, () => _([2])])
      .merge(1)
      .errors((error) => errors.push(error))
      .toArray()

    expect(result).toEqual([2])
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('factory must return an exstream instance')
  },
)

test('destroying merge does not invoke stream factories still outside the window', async () => {
  const release = deferred()
  const invoked = []
  let active
  const merged = _([
    () => {
      invoked.push(0)
      active = _(async (write) => {
        await release.promise
        write(0)
        write(_.nil)
      })
      return active
    },
    () => {
      invoked.push(1)
      return _([1])
    },
  ]).merge(1)
  const completion = merged.drain()

  await waitFor(() => invoked.length === 1, 'merge did not invoke the first factory')
  merged.destroy()
  await nextTurn()

  expect(invoked).toEqual([0])
  expect(active.state).toBe('destroyed')
  release.resolve()
  await completion.catch(() => {})
})

test('ordered merge streams the current inner before it ends', async () => {
  const release = deferred()
  const produced = []
  const emitted = []
  const inner = _(async (write) => {
    produced.push(1)
    write(1)
    await release.promise
    produced.push(2)
    write(2)
    write(_.nil)
  })
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
  const first = _(async (write) => {
    produced.push('first')
    write('first')
    await finishFirst.promise
    write(_.nil)
  })
  const second = _(async (write) => {
    produced.push('second-1')
    write('second-1')
    await finishSecond.promise
    produced.push('second-2')
    write('second-2')
    write(_.nil)
  })
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
  const first = _(async (write) => {
    started.push('first')
    write('first')
    await finishFirst.promise
    completed.push('first')
    write(_.nil)
  })
  const second = _((write) => {
    started.push('second')
    write('second-1')
    write('second-2')
    completed.push('second')
    write(_.nil)
  })
  const third = _((write) => {
    started.push('third')
    write('third')
    completed.push('third')
    write(_.nil)
  })
  const completion = _([first, second, third])
    .merge(2, true)
    .tap((value) => emitted.push(value))
    .toArray()

  await waitFor(() => completed.includes('second'), 'the buffered inner was not consumed eagerly')
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
  const first = _(async (write) => {
    write('first')
    await finishFirst.promise
    write(_.nil)
  })
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
  reservedConsumer.destroy()

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
  const first = _(async (write) => {
    firstStarted++
    active++
    maxActive = Math.max(maxActive, active)
    write(reason)
    await releaseFirst.promise
    write('first')
    active--
    write(_.nil)
  })
  const second = _(async (write) => {
    secondStarted++
    active++
    maxActive = Math.max(maxActive, active)
    write('second')
    active--
    write(_.nil)
  })
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
    _(async (write) => {
      started++
      await release.promise
      write(index)
      write(_.nil)
    }),
  )
  const merged = _(inners).merge(2, true)
  const completion = merged.drain()

  await waitFor(() => started === 2, 'the ordered merge did not activate both inners')
  merged.destroy()
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
    first.abort(reason)

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
  sink.resume()

  await waitFor(() => received === 1, 'the first outer error did not reach the consumer')
  for (let turn = 0; turn < 10; turn++) await nextTurn()
  const transformedWhileBlocked = transformed
  merged.destroy()
  await nextTurn()

  expect(transformedWhileBlocked).toBe(2)
})