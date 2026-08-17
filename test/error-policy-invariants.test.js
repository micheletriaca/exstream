const _ = require('../src/index.js')
const { waitFor } = require('./invariant-helpers.js')

test('skipErrors drops every record error and preserves ordinary data', async () => {
  const errors = [Error('first'), Error('second')]

  const result = await _([1, errors[0], 2, errors[1], 3]).skipErrors().toArray()

  expect(result).toEqual([1, 2, 3])
})

test('skipErrors selectively skips errors with input and lazy context', async () => {
  const seen = []
  const remaining = []

  const result = await _([1, 2, 3])
    .map((value) => {
      if (value > 1) throw Error(`invalid ${value}`)
      return value
    })
    .skipErrors((error, input, context) => {
      seen.push({
        contextInput: context.input,
        input,
        message: error.message,
        signal: context.signal,
      })
      return input === 2
    })
    .errors((error, push, context) => {
      remaining.push({ input: context.input, message: error.message })
    })
    .toArray()

  expect(result).toEqual([1])
  expect(
    seen.map(({ contextInput, input, message }) => ({ contextInput, input, message })),
  ).toEqual([
    { contextInput: 2, input: 2, message: 'invalid 2' },
    { contextInput: 3, input: 3, message: 'invalid 3' },
  ])
  expect(seen.every(({ signal }) => signal instanceof AbortSignal)).toBe(true)
  expect(remaining).toEqual([{ input: 3, message: 'invalid 3' }])
})

test('skipErrors preserves the historical argument list of unary predicates', async () => {
  const predicate = vi.fn(() => true)
  const reason = Error('skip me')

  await _([reason]).skipErrors(predicate).toArray()

  expect(predicate).toHaveBeenCalledWith(reason)
})

test('skipErrors supports predicates that only request the failing input', async () => {
  const seen = []
  const remaining = []

  const result = await _([1, 2])
    .map((value) => {
      throw Error(`invalid ${value}`)
    })
    .skipErrors((error, input) => {
      seen.push([error.message, input])
      return input === 1
    })
    .errors((error) => remaining.push(error.message))
    .toArray()

  expect(result).toEqual([])
  expect(seen).toEqual([
    ['invalid 1', 1],
    ['invalid 2', 2],
  ])
  expect(remaining).toEqual(['invalid 2'])
})

test('skipErrors preserves an existing record context', async () => {
  const context = { correlationId: 'row-1' }
  let received
  let upstreamContext

  await _([1])
    .withContext(() => context)
    .map((value, recordContext) => {
      upstreamContext = recordContext
      throw Error(`invalid ${value}`)
    })
    .skipErrors((error, input, recordContext) => {
      received = { error, input, recordContext }
      return true
    })
    .toArray()

  expect(received.input).toBe(1)
  expect(received.error.message).toBe('invalid 1')
  expect(received.recordContext).toBe(upstreamContext)
  expect(received.recordContext.correlationId).toBe('row-1')
})

test('an exception in a skipErrors predicate remains a contextual record error', async () => {
  const handled = []

  const result = await _([1])
    .map((value) => {
      throw Error(`source ${value}`)
    })
    .skipErrors((error, input, context) => {
      context.stage = 'skip predicate'
      throw Error(`${error.message} cannot be classified`)
    })
    .errors((error, push, context) => {
      handled.push({
        input: context.input,
        message: error.message,
        stage: context.stage,
      })
    })
    .toArray()

  expect(result).toEqual([])
  expect(handled).toEqual([
    { input: 1, message: 'source 1 cannot be classified', stage: 'skip predicate' },
  ])
})

test('failOnError promotes a record error to a fatal graph failure', async () => {
  const reason = Error('invalid record')
  const source = _([1, 2]).map((value) => {
    if (value === 2) throw reason
    return value
  })
  const promoted = source.fork(true).failOnError()
  const sibling = source.fork(true)
  const promotedResult = promoted.toArray()
  const siblingResult = sibling.toArray()

  source.start()

  await expect(promotedResult).rejects.toBe(reason)
  await expect(siblingResult).rejects.toBe(reason)
  expect(reason.exstreamFatal).toBe(true)
  expect(reason.exstreamInput).toBe(2)
  expect(source.state).toBe('aborted')
  expect(promoted.state).toBe('aborted')
  expect(sibling.state).toBe('aborted')
})

test('routeErrors reliably separates data and contextual dead letters', async () => {
  const routed = _([1, 2, 3])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .map((value, context) => {
      context.stage = 'validate'
      if (value === 2) throw Error(`invalid ${value}`)
      return value * 10
    })
    .routeErrors()

  const output = routed.output
    .map((value, context) => ({ correlationId: context.correlationId, value }))
    .toArray()
  const deadLetters = routed.deadLetters
    .map(({ error, input }, context) => ({
      correlationId: context.correlationId,
      input,
      message: error.message,
      stage: context.stage,
    }))
    .toArray()

  await expect(Promise.all([output, deadLetters])).resolves.toEqual([
    [
      { correlationId: 'row-1', value: 10 },
      { correlationId: 'row-3', value: 30 },
    ],
    [{ correlationId: 'row-2', input: 2, message: 'invalid 2', stage: 'validate' }],
  ])
})

test('routeErrors keeps Error data separate from error records', async () => {
  const reason = Error('ambiguous')
  const { deadLetters, output } = _([_.data(reason), reason]).routeErrors()

  await expect(Promise.all([output.toArray(), deadLetters.toArray()])).resolves.toEqual([
    [reason],
    [{ error: reason, input: undefined }],
  ])
})

test('routeErrors applies reliable backpressure until both outputs are consumed', async () => {
  const source = _()
  const { deadLetters, output } = source.routeErrors()
  const outputResult = output.toArray()

  expect(source.write(1)).toBe(false)
  expect(source.write(2)).toBe(false)
  expect(source.buffered).toBe(2)

  const deadLetterResult = deadLetters.toArray()
  await waitFor(() => source.buffered === 0, 'dead-letter consumption did not release the source')
  source.end()

  await expect(Promise.all([outputResult, deadLetterResult])).resolves.toEqual([[1, 2], []])
})

test('fatal failures bypass routeErrors and abort both outputs', async () => {
  const reason = Error('fatal source')
  const source = _()
  const { deadLetters, output } = source.routeErrors()
  const outputResult = output.toArray()
  const deadLetterResult = deadLetters.toArray()

  source.fail(reason, 'input')

  await expect(outputResult).rejects.toBe(reason)
  await expect(deadLetterResult).rejects.toBe(reason)
  expect(output.state).toBe('aborted')
  expect(deadLetters.state).toBe('aborted')
})

test('stopOnError lazily creates and propagates record context', async () => {
  let handled

  const result = await _([1])
    .map((value) => {
      throw Error(`invalid ${value}`)
    })
    .stopOnError((error, push, context) => {
      handled = { context, error }
      context.recovered = true
      push(null, 10)
    })
    .map((value, context) => ({ context, value }))
    .toArray()

  expect(handled.error.message).toBe('invalid 1')
  expect(handled.context.input).toBe(1)
  expect(handled.context.signal).toBeInstanceOf(AbortSignal)
  expect(result).toEqual([{ context: handled.context, value: 10 }])
  expect(result[0].context.recovered).toBe(true)
})

test('stopOnError preserves an existing record context', async () => {
  const context = { correlationId: 'row-1' }
  let received
  let upstreamContext

  await _([1])
    .withContext(() => context)
    .map((value, recordContext) => {
      upstreamContext = recordContext
      throw Error(`invalid ${value}`)
    })
    .stopOnError((error, push, recordContext) => {
      received = recordContext
    })
    .toArray()

  expect(received).toBe(upstreamContext)
  expect(received.correlationId).toBe('row-1')
})

test('contextual error handlers lazily create and propagate record context', async () => {
  let handled

  const result = await _([1])
    .map((value) => {
      throw Error(`invalid ${value}`)
    })
    .errors((error, push, context) => {
      context.recovered = true
      push(null, error.exstreamInput * 2)
    })
    .map((value, context) => {
      handled = { input: context.input, recovered: context.recovered, value }
      return value
    })
    .toArray()

  expect(result).toEqual([2])
  expect(handled).toEqual({ input: 1, recovered: true, value: 2 })
})