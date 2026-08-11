const { monotonicNow, scheduleMicrotask, scheduleNextTurn } = require('../src/scheduler.js')

test('scheduler preserves microtask and next-turn ordering', async () => {
  const events = []
  const nextTurn = new Promise((resolve) => {
    scheduleNextTurn(() => {
      events.push('next turn')
      resolve()
    })
  })

  scheduleMicrotask(() => events.push('microtask'))
  events.push('synchronous')

  await Promise.resolve()
  expect(events).toEqual(['synchronous', 'microtask'])

  await nextTurn
  expect(events).toEqual(['synchronous', 'microtask', 'next turn'])
})

test('next-turn scheduling falls back to browser timers', async () => {
  vi.stubGlobal('setImmediate', undefined)
  try {
    const cancelled = vi.fn()
    scheduleNextTurn(cancelled)()
    await expect(new Promise((resolve) => scheduleNextTurn(() => resolve('done')))).resolves.toBe(
      'done',
    )
    expect(cancelled).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('a scheduled next turn can be cancelled', async () => {
  const callback = vi.fn()
  const cancel = scheduleNextTurn(callback)
  cancel()

  await new Promise((resolve) => scheduleNextTurn(resolve))

  expect(callback).not.toHaveBeenCalled()
})

test('monotonic clock does not move backwards', () => {
  const first = monotonicNow()
  const second = monotonicNow()

  expect(Number.isFinite(first)).toBe(true)
  expect(second).toBeGreaterThanOrEqual(first)
})