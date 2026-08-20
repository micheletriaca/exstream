const _ = require('../src/index.js')
const { deferred, waitFor } = require('./invariant-helpers.js')
const { kAbort } = require('../src/stream-control.js')

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
    .toArray()

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

test('mapAsync refills one slot whenever slow downstream accepts a result', async () => {
  const concurrency = 3
  const started = []
  const writes = []
  const writeGates = []

  const completion = _([1, 2, 3, 4, 5, 6])
    .mapAsync(
      async (value) => {
        started.push(value)
        return value
      },
      { concurrency, ordered: false },
    )
    .pipeTo(
      new WritableStream({
        write(value) {
          const gate = deferred()
          writes.push(value)
          writeGates.push(gate)
          return gate.promise
        },
      }),
    )

  await waitFor(() => writes.length === 1, 'downstream did not accept the first result')
  await waitFor(() => started.length === 4, 'mapAsync did not refill the first released slot')
  expect(started).toEqual([1, 2, 3, 4])

  for (let index = 0; index < 5; index++) {
    writeGates[index].resolve()
    await waitFor(
      () => writes.length === index + 2,
      `downstream did not accept result ${index + 2}`,
    )
    await waitFor(
      () => started.length === Math.min(index + 5, 6),
      `mapAsync did not refill slot ${index + 2}`,
    )
    expect(started.length - writes.length).toBeLessThanOrEqual(concurrency)
  }

  writeGates[5].resolve()
  await completion
  expect(writes).toEqual([1, 2, 3, 4, 5, 6])
})

test('mapAsync emits completion order only when ordered is false', async () => {
  const values = [0, 1, 2, 3, 4]
  const orderedGates = values.map(() => deferred())
  const unorderedGates = values.map(() => deferred())
  const unorderedStarted = []
  const unorderedSeen = []

  const orderedResult = _(values)
    .mapAsync((value) => orderedGates[value].promise.then(() => value), {
      concurrency: 3,
      ordered: true,
    })
    .toArray()
  const unorderedResult = _(values)
    .mapAsync(
      (value) => {
        unorderedStarted.push(value)
        return unorderedGates[value].promise.then(() => value)
      },
      {
        concurrency: 3,
        ordered: false,
      },
    )
    .tap((value) => unorderedSeen.push(value))
    .toArray()

  for (const [value, started] of [
    [2, 4],
    [1, 5],
    [0, 5],
  ]) {
    orderedGates[value].resolve()
    unorderedGates[value].resolve()
    await waitFor(
      () => unorderedStarted.length === started,
      `mapAsync did not refill after value ${value}`,
    )
  }
  orderedGates[4].resolve()
  unorderedGates[4].resolve()
  await waitFor(() => unorderedSeen.includes(4), 'unordered mapAsync did not emit value 4')
  orderedGates[3].resolve()
  unorderedGates[3].resolve()

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
    .toArray()

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
    .toArray()

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
    .toArray()

  expect(result).toEqual([30])
  expect(errors.map(({ code, input, message }) => ({ code, input, message }))).toEqual([
    { code: undefined, input: 1, message: 'string rejection' },
    { code: 'OBJECT_REJECTION', input: 2, message: 'object rejection' },
  ])
  expect(errors.every(({ context }) => context.stage === 'enrich')).toBe(true)
})

test('mapAsync forwards upstream record errors without consuming a mapping slot', async () => {
  const sourceError = Error('upstream record failure')
  const mapped = []
  const errors = []

  const result = await _([1, sourceError, 2])
    .mapAsync(
      async (value) => {
        mapped.push(value)
        return value * 10
      },
      { concurrency: 2, ordered: false },
    )
    .errors((error) => errors.push(error))
    .toArray()

  expect(result).toEqual([10, 20])
  expect(mapped).toEqual([1, 2])
  expect(errors).toHaveLength(1)
  expect(errors[0].message).toBe(sourceError.message)
})

test('mapAsync accepts synchronous results and captures synchronous throws', async () => {
  const errors = []

  const result = await _([1, 2, 3])
    .mapAsync((value) => {
      if (value === 2) throw Error('synchronous failure')
      return value * 2
    })
    .errors((error) => errors.push(error))
    .toArray()

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
  const result = resultStream.toArray()

  await waitFor(() => started.length === 2, 'mapAsync did not start its initial tasks')
  controller.abort(reason)

  await expect(result).rejects.toBe(reason)
  expect(started).toEqual([1, 2])
  expect(signals.every((signal) => signal.aborted && signal.reason === reason)).toBe(true)
  expect(resultStream.state).toBe('aborted')
})

test('mapAsync ignores a task that completes after the graph was aborted', async () => {
  const gate = deferred()
  const reason = Error('abort before completion')
  const started = deferred()
  const resultStream = _([1]).mapAsync(async (value) => {
    started.resolve()
    await gate.promise
    return value * 10
  })
  const result = resultStream.toArray()

  await started.promise
  resultStream[kAbort](reason)
  await expect(result).rejects.toBe(reason)

  gate.resolve()
  await Promise.resolve()
  await Promise.resolve()

  expect(resultStream.state).toBe('aborted')
  expect(resultStream.abortReason).toBe(reason)
})

test('mapAsync stops refilling when downstream ends early', async () => {
  const gates = [deferred(), deferred(), deferred(), deferred()]
  const started = []
  const mapped = _([1, 2, 3, 4]).mapAsync(
    async (value) => {
      started.push(value)
      await gates[value - 1].promise
      return value
    },
    { concurrency: 2, ordered: false },
  )
  const result = mapped.take(1).toArray()

  await waitFor(() => started.length === 2, 'mapAsync did not fill its initial window')
  gates[0].resolve()
  await waitFor(() => started.length === 3, 'mapAsync did not refill the delivered result')
  gates[1].resolve()

  expect(await result).toEqual([1])
  await Promise.resolve()
  await Promise.resolve()
  expect(started).toEqual([1, 2, 3])

  gates[2].resolve()
})

test('mapAsync does not start work when its external signal is already aborted', async () => {
  const controller = new AbortController()
  const reason = Error('already cancelled')
  const operation = vi.fn(async (value) => value)
  controller.abort(reason)

  const result = _([1, 2, 3]).mapAsync(operation, { signal: controller.signal }).toArray()

  await expect(result).rejects.toBe(reason)
  expect(operation).not.toHaveBeenCalled()
})

test.each([
  [{ concurrency: 0 }, 'concurrency must be a positive integer or Infinity'],
  [{ concurrency: 1.5 }, 'concurrency must be a positive integer or Infinity'],
  [{ ordered: 'yes' }, 'ordered must be a boolean'],
  [{ signal: {} }, 'signal must be an AbortSignal'],
  [{ onFail: true }, 'onFail must be a function'],
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

test('mapAsync onFail retries the callback with an enriched input and the same context', async () => {
  const original = { customerId: 7 }
  const inputs = []
  const contexts = []
  const failures = []

  const result = await _([original])
    .mapAsync(
      async (input, context) => {
        inputs.push(input)
        contexts.push(context)
        if (!input.customer) throw Error('customer missing')
        return `${input.customer}:${input.customerId}`
      },
      {
        onFail: async (error, input, push, attempt, retry, context) => {
          failures.push({ attempt, context, error, input })
          await Promise.resolve()
          retry({ ...input, customer: 'Ada' })
        },
      },
    )
    .toArray()

  expect(result).toEqual(['Ada:7'])
  expect(inputs).toEqual([original, { customerId: 7, customer: 'Ada' }])
  expect(contexts[1]).toBe(contexts[0])
  expect(failures).toEqual([
    { attempt: 1, context: contexts[0], error: expect.any(Error), input: original },
  ])
  expect(failures[0].error.message).toBe('customer missing')
  expect(contexts[0].input).toBe(original)
})

test('mapAsync onFail can retry the same input without releasing its concurrency slot', async () => {
  const recovery = deferred()
  const started = []
  let firstAttempts = 0

  const resultPromise = _([1, 2])
    .mapAsync(
      async (value) => {
        started.push(value)
        if (value === 1 && ++firstAttempts === 1) throw Error('temporary failure')
        return value * 10
      },
      {
        concurrency: 1,
        onFail: async (error, input, push, attempt, retry) => {
          expect({ attempt, input, message: error.message }).toEqual({
            attempt: 1,
            input: 1,
            message: 'temporary failure',
          })
          await recovery.promise
          retry()
        },
      },
    )
    .toArray()

  await waitFor(() => firstAttempts === 1, 'failed attempt did not start')
  await Promise.resolve()
  expect(started).toEqual([1])

  recovery.resolve()

  await expect(resultPromise).resolves.toEqual([10, 20])
  expect(started).toEqual([1, 1, 2])
})

test('mapAsync onFail can recover with a replacement output', async () => {
  const result = await _([1, 2])
    .mapAsync(
      async (value) => {
        if (value === 1) throw Error('use fallback')
        return value * 10
      },
      {
        onFail(error, input, push) {
          expect(error.message).toBe('use fallback')
          push(null, input * 100)
        },
      },
    )
    .toArray()

  expect(result).toEqual([100, 20])
})

test('mapAsync onFail can propagate a record error with the current input', async () => {
  const failures = []
  const enriched = { id: 1, customer: null }

  const result = await _([{ id: 1 }])
    .mapAsync(async () => Promise.reject(Error('cannot enrich')), {
      onFail(error, input, push) {
        expect(input).toEqual({ id: 1 })
        push(error, enriched)
      },
    })
    .errors((error) => failures.push(error))
    .toArray()

  expect(result).toEqual([])
  expect(failures).toHaveLength(1)
  expect(failures[0].message).toBe('cannot enrich')
  expect(failures[0].exstreamInput).toBe(enriched)
})

test('mapAsync onFail propagates the original record error when it makes no decision', async () => {
  const failures = []

  const result = await _([3])
    .mapAsync(async () => Promise.reject(Error('unhandled attempt')), {
      onFail: async () => {},
    })
    .errors((error) => failures.push(error))
    .toArray()

  expect(result).toEqual([])
  expect(failures).toHaveLength(1)
  expect(failures[0]).toMatchObject({ exstreamInput: 3, message: 'unhandled attempt' })
})

test('mapAsync onFail failures become record errors for the current input', async () => {
  const failures = []

  await _([5])
    .mapAsync(async () => Promise.reject(Error('operation failure')), {
      onFail: async () => Promise.reject(Error('recovery failure')),
    })
    .errors((error) => failures.push(error))
    .toArray()

  expect(failures).toHaveLength(1)
  expect(failures[0]).toMatchObject({ exstreamInput: 5, message: 'recovery failure' })
})

test('mapAsync onFail rejects more than one recovery decision', async () => {
  const failures = []
  const operation = vi.fn(async () => Promise.reject(Error('operation failure')))

  await _([6])
    .mapAsync(operation, {
      onFail(error, input, push, attempt, retry) {
        retry()
        push(error, input)
      },
    })
    .errors((error) => failures.push(error))
    .toArray()

  expect(operation).toHaveBeenCalledOnce()
  expect(failures).toHaveLength(1)
  expect(failures[0]).toMatchObject({
    exstreamInput: 6,
    message: 'error in .mapAsync(). onFail settled more than once',
  })
})

test('mapAsync onFail can recover from an attempt timeout', async () => {
  const result = await _([9])
    .mapAsync(() => new Promise(() => {}), {
      timeout: 5,
      onFail(error, input, push, attempt) {
        expect(error).toMatchObject({
          attempt: 1,
          code: 'EXSTREAM_MAP_ASYNC_TIMEOUT',
          exstreamInput: 9,
        })
        expect(attempt).toBe(1)
        push(null, input * 10)
      },
    })
    .toArray()

  expect(result).toEqual([90])
})

test('mapAsync never sends fatal failures to onFail', async () => {
  const reason = Error('fatal async operation')
  reason.exstreamFatal = true
  const onFail = vi.fn()

  const result = _([1])
    .mapAsync(async () => Promise.reject(reason), { onFail })
    .toArray()

  await expect(result).rejects.toBe(reason)
  expect(onFail).not.toHaveBeenCalled()
})

test('mapAsync onFail cannot be combined with automatic retry', () => {
  expect(() =>
    _([1]).mapAsync(async (value) => value, {
      onFail() {},
      retry: 1,
    }),
  ).toThrow('onFail cannot be combined with retry')
})

test('mapAsync retries the same input and context without releasing its concurrency slot', async () => {
  const retryDelay = deferred()
  const attempts = new Map()
  const contexts = new Map()
  const started = []

  const resultPromise = _([1, 2])
    .mapAsync(
      async (value, context) => {
        started.push(value)
        const attempt = (attempts.get(value) || 0) + 1
        attempts.set(value, attempt)
        const previousContext = contexts.get(value)
        if (previousContext) expect(context).toBe(previousContext)
        else contexts.set(value, context)
        if (value === 1 && attempt === 1) throw Error('retry first input')
        return value * 10
      },
      {
        concurrency: 1,
        retry: {
          retries: 1,
          delay: async (attempt, error, input, context) => {
            expect({ attempt, input, message: error.message }).toEqual({
              attempt: 1,
              input: 1,
              message: 'retry first input',
            })
            expect(context).toBe(contexts.get(1))
            await retryDelay.promise
            return 0
          },
        },
      },
    )
    .toArray()

  await waitFor(() => attempts.get(1) === 1, 'first attempt did not start')
  await Promise.resolve()
  expect(started).toEqual([1])

  retryDelay.resolve()

  await expect(resultPromise).resolves.toEqual([10, 20])
  expect(started).toEqual([1, 1, 2])
  expect(attempts).toEqual(
    new Map([
      [1, 2],
      [2, 1],
    ]),
  )
})

test('mapAsync retry.when selects retryable failures', async () => {
  const attempts = new Map()
  const failures = []

  const result = await _([1, 2])
    .mapAsync(
      async (value) => {
        const attempt = (attempts.get(value) || 0) + 1
        attempts.set(value, attempt)
        if (value === 1 && attempt === 1) {
          const error = Error('transient')
          error.code = 'TRANSIENT'
          throw error
        }
        if (value === 2) {
          const error = Error('permanent')
          error.code = 'PERMANENT'
          throw error
        }
        return value * 10
      },
      {
        retry: {
          retries: 3,
          when: async (error, input, context, attempt) => {
            expect(input).toBe(error.exstreamInput)
            expect(context.input).toBe(input)
            expect(context.signal).toBeInstanceOf(AbortSignal)
            expect(attempt).toBe(1)
            return error.code === 'TRANSIENT'
          },
        },
      },
    )
    .errors((error) => failures.push(error))
    .toArray()

  expect(result).toEqual([10])
  expect(attempts).toEqual(
    new Map([
      [1, 2],
      [2, 1],
    ]),
  )
  expect(failures.map(({ code, exstreamInput }) => ({ code, exstreamInput }))).toEqual([
    { code: 'PERMANENT', exstreamInput: 2 },
  ])
})

test('mapAsync never retries a fatal failure', async () => {
  const reason = Error('fatal async operation')
  reason.exstreamFatal = true
  const operation = vi.fn(async () => Promise.reject(reason))

  const result = _([1]).mapAsync(operation, { retry: 10 }).toArray()

  await expect(result).rejects.toBe(reason)
  expect(operation).toHaveBeenCalledOnce()
})

test('mapAsync surfaces failures from retry policy callbacks with the original input', async () => {
  const failures = []

  const result = await _([7])
    .mapAsync(async () => Promise.reject(Error('operation failure')), {
      retry: {
        retries: 1,
        when: async () => {
          throw Error('policy failure')
        },
      },
    })
    .errors((error) => failures.push(error))
    .toArray()

  expect(result).toEqual([])
  expect(failures).toHaveLength(1)
  expect(failures[0].message).toBe('policy failure')
  expect(failures[0].exstreamInput).toBe(7)
})

test('mapAsync supports a fixed retry delay', async () => {
  let attempts = 0

  const result = await _([1])
    .mapAsync(
      async (value) => {
        attempts++
        if (attempts === 1) throw Error('retry once')
        return value * 10
      },
      { retry: { retries: 1, delay: 1 } },
    )
    .toArray()

  expect(result).toEqual([10])
  expect(attempts).toBe(2)
})

test('mapAsync timeout aborts an attempt signal and retries with the same context', async () => {
  const contexts = []
  const signals = []
  let attempts = 0

  const result = await _([1])
    .mapAsync(
      (value, context) => {
        attempts++
        contexts.push(context)
        signals.push(context.signal)
        if (attempts === 2) return value * 10
        return new Promise((resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), {
            once: true,
          })
        })
      },
      { retry: 1, timeout: 5 },
    )
    .toArray()

  expect(result).toEqual([10])
  expect(attempts).toBe(2)
  expect(contexts[1]).toBe(contexts[0])
  expect(signals[1]).not.toBe(signals[0])
  expect(signals[0].aborted).toBe(true)
  expect(signals[0].reason).toBeInstanceOf(_.MapAsyncTimeoutError)
  expect(contexts[0].signal.aborted).toBe(false)
})

test('mapAsync emits a descriptive timeout error after retries are exhausted', async () => {
  const failures = []

  const result = await _([42, 43])
    .mapAsync(() => new Promise(() => {}), { concurrency: 2, timeout: 5 })
    .errors((error) => failures.push(error))
    .toArray()

  expect(result).toEqual([])
  expect(failures).toHaveLength(2)
  for (const [index, failure] of failures.entries()) {
    expect(failure).toBeInstanceOf(_.MapAsyncTimeoutError)
    expect(failure).toMatchObject({
      attempt: 1,
      code: 'EXSTREAM_MAP_ASYNC_TIMEOUT',
      exstreamInput: 42 + index,
      timeout: 5,
    })
  }
})

test('mapAsync releases its shared timeout timer after successful completion', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const result = await _([1, 2, 3])
      .mapAsync(async (value) => value * 10, { concurrency: 3, timeout: 10_000 })
      .toArray()

    expect(result).toEqual([10, 20, 30])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

test('aborting mapAsync during retry delay prevents another attempt', async () => {
  const controller = new AbortController()
  const reason = Error('cancel retry delay')
  const delayStarted = deferred()
  let attempts = 0

  const result = _([1])
    .mapAsync(
      async () => {
        attempts++
        throw Error('retry me')
      },
      {
        retry: {
          retries: 2,
          delay: async () => {
            delayStarted.resolve()
            return 10_000
          },
        },
        signal: controller.signal,
      },
    )
    .toArray()

  await delayStarted.promise
  controller.abort(reason)

  await expect(result).rejects.toBe(reason)
  expect(attempts).toBe(1)
})

test('mapAsync observes an abort raised before retry delay starts', async () => {
  const controller = new AbortController()
  const reason = Error('abort between attempts')
  let attempts = 0

  const result = _([1])
    .mapAsync(
      async () => {
        attempts++
        controller.abort(reason)
        throw Error('failed attempt')
      },
      { retry: 1, signal: controller.signal },
    )
    .toArray()

  await expect(result).rejects.toBe(reason)
  expect(attempts).toBe(1)
})

test.each([
  [{ retry: -1 }, 'retry must be a non-negative integer or an object'],
  [{ retry: 1.5 }, 'retry must be a non-negative integer or an object'],
  [{ retry: { retries: -1 } }, 'retry.retries must be a non-negative integer'],
  [{ retry: { when: true } }, 'retry.when must be a function'],
  [{ retry: { delay: -1 } }, 'retry.delay must be a non-negative number or a function'],
  [{ timeout: -1 }, 'timeout must be a non-negative finite number'],
  [{ timeout: Infinity }, 'timeout must be a non-negative finite number'],
  [{ retry: Symbol('retries') }, 'retry must be a non-negative integer or an object'],
  [{ retry: { retries: Symbol('retries') } }, 'retry.retries must be a non-negative integer'],
  [
    { retry: { retries: 1, delay: Symbol('delay') } },
    'retry.delay must be a non-negative number or a function',
  ],
  [{ timeout: Symbol('timeout') }, 'timeout must be a non-negative finite number'],
])('mapAsync validates task policy options: %j', (options, message) => {
  expect(() => _([1]).mapAsync(async (value) => value, options)).toThrow(message)
})

test('mapAsync reports an invalid dynamic retry delay as a record error', async () => {
  const failures = []

  const result = await _([1])
    .mapAsync(async () => Promise.reject(Error('retry me')), {
      retry: { retries: 1, delay: () => -1 },
    })
    .errors((error) => failures.push(error))
    .toArray()

  expect(result).toEqual([])
  expect(failures).toHaveLength(1)
  expect(failures[0].message).toBe('error in .mapAsync(). retry.delay returned an invalid delay')
  expect(failures[0].exstreamInput).toBe(1)
})

test('mapAsync treats an empty retry policy as no retries', async () => {
  const operation = vi.fn(async () => Promise.reject(Error('do not retry')))
  const failures = []

  await _([1])
    .mapAsync(operation, { retry: {} })
    .errors((error) => failures.push(error))
    .toArray()

  expect(operation).toHaveBeenCalledOnce()
  expect(failures).toHaveLength(1)
})