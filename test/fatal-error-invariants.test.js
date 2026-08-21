const _ = require('../src/index.js')
const { waitFor } = require('./invariant-helpers.js')
const { kFail } = require('../src/stream-control.js')

test('a fatal error rejects every reliable branch and aborts the graph', async () => {
  const reason = Error('fatal source failure')
  const source = _(null, { start: 'manual' })
  const first = source.fork()
  const second = source.fork()
  const firstResult = first.toArray()
  const secondResult = second.toArray()

  source.write(1)
  source[kFail](reason)

  await expect(firstResult).rejects.toBe(reason)
  await expect(secondResult).rejects.toBe(reason)
  for (const stream of [source, first, second]) {
    expect(stream.state).toBe('aborted')
    expect(stream.abortReason).toBe(reason)
  }
})

test('a fatal error bypasses record error handlers', async () => {
  const reason = Error('not recoverable')
  const source = _()
  const errors = vi.fn()
  const result = source.errors(errors).toArray()

  source[kFail](reason)

  await expect(result).rejects.toBe(reason)
  expect(errors).not.toHaveBeenCalled()
})

test('failing one branch aborts its source and every sibling', async () => {
  const reason = Error('branch failure')
  const source = _(null, { start: 'manual' })
  const failed = source.fork()
  const sibling = source.fork()
  const failedResult = failed.toArray()
  const siblingResult = sibling.toArray()

  failed[kFail](reason)

  await expect(failedResult).rejects.toBe(reason)
  await expect(siblingResult).rejects.toBe(reason)
  expect(source.state).toBe('aborted')
  expect(sibling.state).toBe('aborted')
})

test('fatal non-Error reasons are normalized and preserve their input', async () => {
  const source = _()
  const result = source.toArray()
  const input = { id: 42 }
  const reason = { message: 'remote fatal', code: 'REMOTE_FATAL' }

  source[kFail](reason, input)

  const error = await result.catch((failure) => failure)
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toBe('remote fatal')
  expect(error.code).toBe('REMOTE_FATAL')
  expect(error.reason).toBe(reason)
  expect(error.exstreamInput).toBe(input)
  expect(error.exstreamFatal).toBe(true)
  expect(source.abortReason).toBe(error)
})

test('fail is idempotent without a sink and preserves the first fatal reason', () => {
  const first = Error('first fatal')
  const second = Error('second fatal')
  let source
  const fatal = vi.fn(() => source[kFail](second, 'reentrant input'))
  const abort = vi.fn()
  source = _().on('fatal', fatal).on('abort', abort)

  source[kFail](first, 'first input')
  source[kFail](Error('third fatal'), 'ended input')

  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBe(first)
  expect(fatal).toHaveBeenCalledOnce()
  expect(fatal).toHaveBeenCalledWith(first, 'first input')
  expect(abort).toHaveBeenCalledOnce()
  expect(abort).toHaveBeenCalledWith(first)
})

test('fatal errors reach observers and release the whole graph', async () => {
  const reason = Error('observed fatal')
  const source = _()
  const observer = source.observe()
  const mainResult = source.toArray()
  const observerResult = observer.toArray()

  source[kFail](reason)

  await expect(mainResult).rejects.toBe(reason)
  await expect(observerResult).rejects.toBe(reason)
  expect(source.eventNames()).toEqual([])
  expect(observer.eventNames()).toEqual([])
})

test.each([false, true])(
  'fatal errors close merge graphs (preserveOrder: %s)',
  async (preserveOrder) => {
    const reason = Error('fatal substream')
    const substream = _()
    const merged = _([substream]).merge({ concurrency: 1, ordered: preserveOrder })
    const result = merged.toArray()
    await waitFor(() => substream.state === 'running', 'merge did not start its substream')

    substream[kFail](reason)

    await expect(result).rejects.toBe(reason)
    expect(substream.state).toBe('aborted')
    expect(merged.state).toBe('aborted')
  },
)