const _ = require('../src/index.js')
const { deferred, waitFor } = require('./invariant-helpers.js')

test('mapAsync never invokes more than concurrency operations', async () => {
  const concurrency = 3
  const values = Array.from({ length: 12 }, (_, index) => index)
  const releases = []
  let active = 0
  let maxActive = 0

  const resultPromise = _(values)
    .mapAsync(
      (value) =>
        new Promise((resolve) => {
          active++
          maxActive = Math.max(maxActive, active)
          releases.push(() => {
            active--
            resolve(value * 2)
          })
        }),
      { concurrency, ordered: false },
    )
    .toPromise()

  await waitFor(() => releases.length === concurrency, 'mapAsync did not fill its initial window')
  expect(active).toBe(concurrency)

  for (let index = 0; index < values.length; index++) {
    await waitFor(() => releases.length > index, `operation ${index} was not started`)
    expect(active).toBeLessThanOrEqual(concurrency)
    releases[index]()
  }

  expect(await resultPromise).toEqual(values.map((value) => value * 2))
  expect(maxActive).toBe(concurrency)
})

test('mapAsync emits completion order only when ordered is false', async () => {
  const values = [0, 1, 2, 3, 4]
  const orderedGates = values.map(() => deferred())
  const unorderedGates = values.map(() => deferred())

  const orderedResult = _(values)
    .mapAsync((value) => orderedGates[value].promise.then(() => value), {
      concurrency: 3,
      ordered: true,
    })
    .toPromise()
  const unorderedResult = _(values)
    .mapAsync((value) => unorderedGates[value].promise.then(() => value), {
      concurrency: 3,
      ordered: false,
    })
    .toPromise()

  for (const value of [2, 1, 0, 4, 3]) {
    orderedGates[value].resolve()
    unorderedGates[value].resolve()
    await Promise.resolve()
  }

  expect(await orderedResult).toEqual(values)
  expect(await unorderedResult).toEqual([2, 1, 0, 4, 3])
})

test('mapAsync lazily creates and preserves record context', async () => {
  const contexts = []

  const result = await _([1, 2])
    .mapAsync(async (value, context) => {
      contexts.push(context)
      context.output = value * 10
      await Promise.resolve()
      return context.output
    })
    .map((value, context) => ({ context, value }))
    .toPromise()

  expect(result).toEqual([
    { context: contexts[0], value: 10 },
    { context: contexts[1], value: 20 },
  ])
  expect(contexts.map((context) => context.input)).toEqual([1, 2])
  expect(contexts.every((context) => context.signal instanceof AbortSignal)).toBe(true)
})

test('mapAsync preserves an existing branch context', async () => {
  const seen = []

  const result = await _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .mapAsync(async (value, context) => {
      seen.push(context)
      return value * 10
    })
    .map((value, context) => ({ context, value }))
    .toPromise()

  expect(result.map(({ value }) => value)).toEqual([10, 20])
  expect(result.map(({ context }) => context)).toEqual(seen)
  expect(seen.map(({ correlationId }) => correlationId)).toEqual(['row-1', 'row-2'])
})

test('mapAsync normalizes throws and rejections while preserving input and context', async () => {
  const errors = []

  const result = await _([1, 2, 3])
    .mapAsync(async (value, context) => {
      context.stage = 'enrich'
      if (value === 1) throw 'string rejection'
      if (value === 2) throw { code: 'OBJECT_REJECTION', message: 'object rejection' }
      return value * 10
    })
    .errors((error, push, context) => {
      errors.push({ code: error.code, input: error.exstreamInput, message: error.message, context })
    })
    .toPromise()

  expect(result).toEqual([30])
  expect(errors.map(({ code, input, message }) => ({ code, input, message }))).toEqual([
    { code: undefined, input: 1, message: 'string rejection' },
    { code: 'OBJECT_REJECTION', input: 2, message: 'object rejection' },
  ])
  expect(errors.every(({ context }) => context.stage === 'enrich')).toBe(true)
})

test('mapAsync accepts synchronous results and captures synchronous throws', async () => {
  const errors = []

  const result = await _([1, 2, 3])
    .mapAsync((value) => {
      if (value === 2) throw Error('synchronous failure')
      return value * 2
    })
    .errors((error) => errors.push(error))
    .toPromise()

  expect(result).toEqual([2, 6])
  expect(errors).toHaveLength(1)
  expect(errors[0].message).toBe('synchronous failure')
  expect(errors[0].exstreamInput).toBe(2)
})

test('mapAsync aborts active contexts and does not schedule more work', async () => {
  const controller = new AbortController()
  const reason = Error('cancel async map')
  const started = []
  const signals = []
  const resultStream = _([1, 2, 3, 4]).mapAsync(
    (value, context) => {
      started.push(value)
      signals.push(context.signal)
      return new Promise(() => {})
    },
    { concurrency: 2, signal: controller.signal },
  )
  const result = resultStream.toPromise()

  await waitFor(() => started.length === 2, 'mapAsync did not start its initial tasks')
  controller.abort(reason)

  await expect(result).rejects.toBe(reason)
  expect(started).toEqual([1, 2])
  expect(signals.every((signal) => signal.aborted && signal.reason === reason)).toBe(true)
  expect(resultStream.state).toBe('aborted')
})

test('mapAsync does not start work when its external signal is already aborted', async () => {
  const controller = new AbortController()
  const reason = Error('already cancelled')
  const operation = vi.fn(async (value) => value)
  controller.abort(reason)

  const result = _([1, 2, 3]).mapAsync(operation, { signal: controller.signal }).toPromise()

  await expect(result).rejects.toBe(reason)
  expect(operation).not.toHaveBeenCalled()
})

test.each([
  [{ concurrency: 0 }, 'concurrency must be a positive integer or Infinity'],
  [{ concurrency: 1.5 }, 'concurrency must be a positive integer or Infinity'],
  [{ ordered: 'yes' }, 'ordered must be a boolean'],
  [{ signal: {} }, 'signal must be an AbortSignal'],
])('mapAsync validates options: %j', (options, message) => {
  expect(() => _([1]).mapAsync(async (value) => value, options)).toThrow(message)
})

test.each(['invalid', [], 1])('mapAsync rejects a non-object options value: %j', (options) => {
  expect(() => _([1]).mapAsync(async (value) => value, options)).toThrow(
    'options must be an object',
  )
})

test('mapAsync requires a mapping function', () => {
  expect(() => _([1]).mapAsync(null)).toThrow('fn must be a function')
})