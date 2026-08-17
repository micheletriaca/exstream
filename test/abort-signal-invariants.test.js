const _ = require('../src/index.js')
const { nextTurn, waitFor } = require('./invariant-helpers.js')

test('an external AbortSignal aborts a source and rejects its sink', async () => {
  const controller = new AbortController()
  const reason = Error('external cancellation')
  const source = _(null, { signal: controller.signal })
  const result = source.toArray()

  controller.abort(reason)

  await expect(result).rejects.toBe(reason)
  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBe(reason)
  expect(source.signal.aborted).toBe(true)
  expect(source.signal.reason).toBe(reason)
})

test('an already aborted signal prevents a source from starting', () => {
  const controller = new AbortController()
  const reason = Error('already cancelled')
  controller.abort(reason)

  const source = _([1, 2, 3], { signal: controller.signal })

  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBe(reason)
  expect(source.signal.reason).toBe(reason)
})

test('source options reject values that are not AbortSignals', () => {
  expect(() => _([1], { signal: {} })).toThrow('signal must be an AbortSignal')
})

test('aborting one fork rejects its sink without cancelling a sibling', async () => {
  const reason = Error('branch cancelled')
  const source = _([1, 2, 3])
  const cancelled = source.fork(true)
  const sibling = source.fork(true)
  const cancelledResult = cancelled.toArray()
  const siblingResult = sibling.toArray()

  cancelled.abort(reason)

  await expect(cancelledResult).rejects.toBe(reason)
  expect(cancelled.signal.reason).toBe(reason)
  expect(source.state).toBe('idle')
  await source.start()
  await expect(siblingResult).resolves.toEqual([1, 2, 3])
})

test('map receives a signal that cancels pending work after downstream abort', async () => {
  const reason = Error('stop pending task')
  let taskSignal
  let rejectTask
  const mapped = _([1]).map(
    (value, context) =>
      new Promise((resolve, reject) => {
        taskSignal = context.signal
        rejectTask = reject
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true,
        })
      }),
  )
  const resolved = mapped.mapAsync((value) => value)
  const result = resolved.toArray()
  await waitFor(() => taskSignal, 'map did not start its task')

  resolved.abort(reason)

  await expect(result).rejects.toBe(reason)
  expect(taskSignal.aborted).toBe(true)
  expect(taskSignal.reason).toBe(reason)
  rejectTask(reason)
  await nextTurn()
})

test('context-aware async predicates and maps receive their branch signal', async () => {
  const signals = []

  const result = await _([1, 2, 3])
    .asyncFilter(async (value, context) => {
      signals.push(context.signal)
      return value > 1
    })
    .map((value, context) => {
      signals.push(context.signal)
      return value
    })
    .toArray()

  expect(result).toEqual([2, 3])
  expect(signals).toHaveLength(5)
  for (const signal of signals) {
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  }
})

test('normal completion does not abort the stream signal', async () => {
  const source = _([1])

  expect(await source.toArray()).toEqual([1])
  expect(source.signal.aborted).toBe(false)
  source.destroy()
  expect(source.signal.aborted).toBe(false)
})

test('abort without a reason creates one stable AbortError', () => {
  const source = _(null)
  const signal = source.signal

  source.abort()
  source.abort(Error('ignored second reason'))

  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBe(signal.reason)
  expect(source.abortReason.name).toBe('AbortError')
})

test('destroy aborts a signal that was already observed', () => {
  const source = _(null)
  const signal = source.signal

  source.destroy()

  expect(source.state).toBe('destroyed')
  expect(signal.aborted).toBe(true)
  expect(signal.reason.name).toBe('AbortError')
})