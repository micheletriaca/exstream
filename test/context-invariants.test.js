const _ = require('../src/index.js')
const { waitFor } = require('./invariant-helpers.js')

test('withContext creates per-record context preserved by one-to-one operators', async () => {
  const result = await _([1, 2, 3])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .map((value, context) => {
      context.mapped = value * 2
      return value * 2
    })
    .filter((value, context) => context.input !== 2 && value > 0)
    .tap((value, context) => {
      context.tapped = value
    })
    .map((value, context) => ({
      correlationId: context.correlationId,
      input: context.input,
      mapped: context.mapped,
      output: value,
      tapped: context.tapped,
    }))
    .toArray()

  expect(result).toEqual([
    { correlationId: 'row-1', input: 1, mapped: 2, output: 2, tapped: 2 },
    { correlationId: 'row-3', input: 3, mapped: 6, output: 6, tapped: 6 },
  ])
})

test('withContext supports Express-style mutation without returning additions', async () => {
  const result = await _([1])
    .withContext((value, context) => {
      context.correlationId = `row-${value}`
    })
    .map((value, context) => context.correlationId)
    .single()

  expect(result).toBe('row-1')
})

test('extendContext supports asynchronous type-shaped enrichment', async () => {
  const result = await _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .extendContext(async (value, context) => ({
      customer: { id: value, correlationId: context.correlationId },
    }))
    .map((value, context) => ({ value, customer: context.customer }))
    .toArray()

  expect(result).toEqual([
    { value: 1, customer: { id: 1, correlationId: 'row-1' } },
    { value: 2, customer: { id: 2, correlationId: 'row-2' } },
  ])
})

test('a binary callback lazily creates context without withContext', async () => {
  const result = await _([2])
    .map((value, context) => ({
      input: context.input,
      signal: context.signal,
      value,
    }))
    .single()

  expect(result.input).toBe(2)
  expect(result.value).toBe(2)
  expect(result.signal).toBeInstanceOf(AbortSignal)
  expect(
    await _([1])
      .map((value, context) => value - context.input)
      .single(),
  ).toBe(0)
  expect(
    await _([1, 2])
      .reject((value, context) => context.input === value && value === 1)
      .toArray(),
  ).toEqual([2])
})

test('unary callbacks retain their historical argument list', async () => {
  const transform = vi.fn((value) => value * 2)

  expect(await _([2]).map(transform).single()).toBe(4)
  expect(transform).toHaveBeenCalledWith(2)
})

test('concurrent promise resolution keeps input and output contexts correlated', async () => {
  const contexts = new Set()
  const result = await _([1, 2, 3, 4])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .map(async (value, context) => {
      contexts.add(context)
      await Promise.resolve()
      context.resolved = value * 10
      return value * 2
    })
    .mapAsync((value) => value, { concurrency: 4, ordered: false })
    .map((value, context) => ({
      correlationId: context.correlationId,
      input: context.input,
      output: value,
      resolved: context.resolved,
    }))
    .toArray()

  expect(contexts.size).toBe(4)
  expect(result).toEqual([
    { correlationId: 'row-1', input: 1, output: 2, resolved: 10 },
    { correlationId: 'row-2', input: 2, output: 4, resolved: 20 },
    { correlationId: 'row-3', input: 3, output: 6, resolved: 30 },
    { correlationId: 'row-4', input: 4, output: 8, resolved: 40 },
  ])
})

test('forks receive shallow context copies that evolve independently', async () => {
  const source = _([1, 2]).withContext((value) => ({ correlationId: `row-${value}` }))
  const firstSignals = new Set()
  const secondSignals = new Set()
  const first = source
    .fork()
    .map((value, context) => {
      firstSignals.add(context.signal)
      context.destination = 'first'
      return { value, destination: context.destination, correlationId: context.correlationId }
    })
    .toArray()
  const second = source
    .fork()
    .map((value, context) => {
      secondSignals.add(context.signal)
      context.destination = 'second'
      return { value, destination: context.destination, correlationId: context.correlationId }
    })
    .toArray()

  await expect(Promise.all([first, second])).resolves.toEqual([
    [
      { value: 1, destination: 'first', correlationId: 'row-1' },
      { value: 2, destination: 'first', correlationId: 'row-2' },
    ],
    [
      { value: 1, destination: 'second', correlationId: 'row-1' },
      { value: 2, destination: 'second', correlationId: 'row-2' },
    ],
  ])
  expect([...firstSignals][0]).not.toBe([...secondSignals][0])
})

test('observers cannot mutate the reliable branch context', async () => {
  const source = _([1]).withContext(() => ({ destination: 'source' }))
  const observer = source.observe().map((value, context) => {
    context.destination = 'observer'
    return context.destination
  })
  const main = source.map((value, context) => {
    context.destination = 'main'
    return context.destination
  })

  expect(await main.toArray()).toEqual(['main'])
  expect(await observer.toArray()).toEqual(['observer'])
})

test('record error handlers receive the context that caused the error', async () => {
  const result = await _([1])
    .withContext(() => ({ stage: 'source' }))
    .map((value, context) => {
      context.stage = 'map'
      throw Error(`invalid ${value}`)
    })
    .errors((error, push, context) => {
      push(null, {
        input: context.input,
        message: error.message,
        stage: context.stage,
      })
    })
    .toArray()

  expect(result).toEqual([{ input: 1, message: 'invalid 1', stage: 'map' }])
})

test('context rejects attempts to replace its managed signal', async () => {
  const errors = []
  const result = await _([1])
    .withContext(() => ({ signal: 'not allowed' }))
    .errors((error) => errors.push(error))
    .toArray()

  expect(result).toEqual([])
  expect(errors).toHaveLength(1)
  expect(errors[0].message).toBe('context signal is managed by Exstream')
})

test('flatten gives every emitted child an independent shallow context', async () => {
  const contexts = []
  const result = await _([[1, 2]])
    .withContext(() => ({ correlationId: 'row-1' }))
    .flatten()
    .map((value, context) => {
      contexts.push(context)
      const previousChild = context.child
      context.child = value
      return { correlationId: context.correlationId, previousChild, value }
    })
    .toArray()

  expect(result).toEqual([
    { correlationId: 'row-1', previousChild: undefined, value: 1 },
    { correlationId: 'row-1', previousChild: undefined, value: 2 },
  ])
  expect(contexts[0]).not.toBe(contexts[1])
})

test('batch and collect expose aligned parent contexts on their aggregate', async () => {
  const batched = await _([1, 2, 3])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .batch(2)
    .map((values, context) => ({
      inputs: context.contexts.map((parent) => parent.input),
      sameInput: context.input === values,
      values,
    }))
    .toArray()

  const collected = await _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .collect()
    .map((values, context) => ({
      correlationIds: context.contexts.map((parent) => parent.correlationId),
      sameInput: context.input === values,
      values,
    }))
    .single()

  expect(batched).toEqual([
    { inputs: [1, 2], sameInput: true, values: [1, 2] },
    { inputs: [3], sameInput: true, values: [3] },
  ])
  expect(collected).toEqual({
    correlationIds: ['row-1', 'row-2'],
    sameInput: true,
    values: [1, 2],
  })
})

test('reduce receives each record context and emits an aggregate context', async () => {
  const seen = []
  const result = await _([1, 2, 3])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .reduce((total, value, context) => {
      seen.push(context.correlationId)
      return total + value
    }, 0)
    .map((total, context) => ({
      inputs: context.contexts.map((parent) => parent.input),
      sameInput: context.input === total,
      total,
    }))
    .single()

  expect(seen).toEqual(['row-1', 'row-2', 'row-3'])
  expect(result).toEqual({ inputs: [1, 2, 3], sameInput: true, total: 6 })
})

test('ordered mapAsync keeps contexts correlated when promises settle out of order', async () => {
  const resolvers = []
  const result = _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .map(
      (value, context) =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(value * 10))
          context.started = true
        }),
    )
    .mapAsync((value) => value, { concurrency: 2, ordered: true })
    .map((value, context) => ({
      correlationId: context.correlationId,
      input: context.input,
      started: context.started,
      value,
    }))
    .toArray()

  await waitFor(() => resolvers.length === 2, 'mapAsync did not start both promises')
  resolvers[1]()
  await Promise.resolve()
  resolvers[0]()

  await expect(result).resolves.toEqual([
    { correlationId: 'row-1', input: 1, started: true, value: 10 },
    { correlationId: 'row-2', input: 2, started: true, value: 20 },
  ])
})

test('unordered merge preserves each substream record context', async () => {
  const first = _([1, 2]).withContext((value) => ({ source: 'first', sourceValue: value }))
  const second = _([3]).withContext((value) => ({ source: 'second', sourceValue: value }))

  const result = await _([first, second])
    .merge({ concurrency: 2, ordered: false })
    .map((value, context) => ({
      input: context.input,
      source: context.source,
      sourceValue: context.sourceValue,
      value,
    }))
    .toArray()

  expect(result.toSorted((a, b) => a.value - b.value)).toEqual([
    { input: 1, source: 'first', sourceValue: 1, value: 1 },
    { input: 2, source: 'first', sourceValue: 2, value: 2 },
    { input: 3, source: 'second', sourceValue: 3, value: 3 },
  ])
})

test('ordered merge preserves record contexts while buffering substreams', async () => {
  const first = _([1, 2]).withContext((value) => ({ source: 'first', sourceValue: value }))
  const second = _([3]).withContext((value) => ({ source: 'second', sourceValue: value }))

  const result = await _([first, second])
    .merge({ concurrency: 2, ordered: true })
    .map((value, context) => ({
      input: context.input,
      source: context.source,
      sourceValue: context.sourceValue,
      value,
    }))
    .toArray()

  expect(result).toEqual([
    { input: 1, source: 'first', sourceValue: 1, value: 1 },
    { input: 2, source: 'first', sourceValue: 2, value: 2 },
    { input: 3, source: 'second', sourceValue: 3, value: 3 },
  ])
})

test.each([null, [], 'invalid'])(
  'withContext turns an invalid initializer result into a record error: %j',
  async (invalid) => {
    const errors = []
    const result = await _([1])
      .withContext(() => invalid)
      .errors((error) => errors.push(error))
      .toArray()

    expect(result).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('context initializer must return an object or undefined')
  },
)

test('withContext can establish a fresh boundary over an existing context', async () => {
  let firstContext
  let secondContext
  const result = await _([1])
    .withContext((value, context) => {
      firstContext = context
      return { correlationId: `row-${value}` }
    })
    .withContext((value, context) => {
      secondContext = context
      return { stage: 'second' }
    })
    .map((value, context) => ({
      correlationId: context.correlationId,
      input: context.input,
      stage: context.stage,
      value,
    }))
    .single()

  expect(result).toEqual({ correlationId: 'row-1', input: 1, stage: 'second', value: 1 })
  expect(secondContext).not.toBe(firstContext)
  expect(secondContext.signal).not.toBe(firstContext.signal)
})

test('withContext without an initializer still establishes input and signal', async () => {
  const result = await _([1])
    .withContext()
    .map((value, context) => ({ input: context.input, signal: context.signal, value }))
    .single()

  expect(result.input).toBe(1)
  expect(result.signal).toBeInstanceOf(AbortSignal)
  expect(result.value).toBe(1)
})

test('context is preserved through reject and mapAsync', async () => {
  const recovered = await _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .reject((value, context) => value === 1 && context.correlationId === 'row-1')
    .mapAsync(async (value, context) => ({
      value,
      correlationId: context.correlationId,
      input: context.input,
    }))
    .toArray()

  expect(recovered).toEqual([{ value: 2, correlationId: 'row-2', input: 2 }])
})

test('contextual map preserves context in sync and async wrap mode', async () => {
  const sync = await _([1])
    .withContext(() => ({ correlationId: 'sync' }))
    .map((value, context) => value + Number(context.input === value), { wrap: true })
    .map((value, context) => ({
      correlationId: context.correlationId,
      input: value.input,
      output: value.output,
    }))
    .single()

  const async = await _([2])
    .withContext(() => ({ correlationId: 'async' }))
    .map((value, context) => Promise.resolve(value + Number(context.input === value)), {
      wrap: true,
    })
    .mapAsync((value) => value)
    .map((value, context) => ({
      correlationId: context.correlationId,
      input: value.input,
      output: value.output,
    }))
    .toArray()

  expect(sync).toEqual({ input: 1, output: 2, correlationId: 'sync' })
  expect(async).toEqual([{ input: 2, output: 3, correlationId: 'async' }])
})

test('context survives async operators and contextual rejection recovery', async () => {
  const errors = []
  const result = await _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .ratelimit(10, 0)
    .mapAsync(async (value, context) => {
      try {
        if (value === 1) throw Error('rejected')
        return value
      } catch (error) {
        errors.push({ correlationId: context.correlationId, message: error.message })
        return context.input
      }
    })
    .map((value, context) => ({ correlationId: context.correlationId, value }))
    .toArray()

  expect(result).toEqual([
    { correlationId: 'row-1', value: 1 },
    { correlationId: 'row-2', value: 2 },
  ])
  expect(errors).toEqual([{ correlationId: 'row-1', message: 'rejected' }])
})

test('contextual filter failures remain correlated record errors', async () => {
  let failure
  const result = await _([1])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .filter((_value, context) => {
      if (context.input === 1) throw Error('predicate failed')
      return true
    })
    .errors((error, push, context) => {
      failure = { correlationId: context.correlationId, message: error.message }
    })
    .toArray()

  expect(result).toEqual([])
  expect(failure).toEqual({ correlationId: 'row-1', message: 'predicate failed' })
})

test('a contextual stopOnError handler receives the failing record context', async () => {
  let handled
  const result = await _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .map((value) => {
      if (value === 2) throw Error('stop')
      return value
    })
    .stopOnError((error, push, context) => {
      handled = { correlationId: context.correlationId, message: error.message }
    })
    .toArray()

  expect(result).toEqual([1])
  expect(handled).toEqual({ correlationId: 'row-2', message: 'stop' })
})

test('reduce1 aggregates all contexts and isolates reducer failures', async () => {
  const success = await _([1, 2, 3])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .reduce1((total, value, context) => total + value + Number(context.input === value))
    .map((total, context) => ({
      inputs: context.contexts.map((parent) => parent.input),
      total,
    }))
    .single()

  let failureContext
  const failed = await _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .reduce((total, value) => {
      if (value === 2) throw Error('invalid reducer input')
      return total + value
    }, 0)
    .errors((error, push, context) => {
      failureContext = context
    })
    .toArray()

  expect(success).toEqual({ inputs: [1, 2, 3], total: 8 })
  expect(failed).toEqual([undefined])
  expect(failureContext.correlationId).toBe('row-2')
})