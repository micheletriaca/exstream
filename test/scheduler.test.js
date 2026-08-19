const { AsyncLocalStorage } = require('node:async_hooks')
const {
  createCooperativeScheduler,
  monotonicNow,
  scheduleMicrotask,
  scheduleNextTurn,
} = require('../src/scheduler.js')

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

test('next-turn scheduling uses a browser task without timer clamping', async () => {
  vi.stubGlobal('setImmediate', undefined)
  const timeout = vi.spyOn(globalThis, 'setTimeout')
  try {
    const cancelled = vi.fn()
    scheduleNextTurn(cancelled)()
    await expect(new Promise((resolve) => scheduleNextTurn(() => resolve('done')))).resolves.toBe(
      'done',
    )
    expect(cancelled).not.toHaveBeenCalled()
    expect(timeout).not.toHaveBeenCalled()
  } finally {
    timeout.mockRestore()
    vi.unstubAllGlobals()
  }
})

test('next-turn scheduling falls back to timers without a task channel', async () => {
  vi.stubGlobal('setImmediate', undefined)
  vi.stubGlobal('MessageChannel', undefined)
  try {
    await expect(new Promise((resolve) => scheduleNextTurn(() => resolve('done')))).resolves.toBe(
      'done',
    )
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

test('cooperative scheduling uses microtasks until its time budget expires', async () => {
  const snapshots = [0, 1, 4]
  const schedule = createCooperativeScheduler(4, () => snapshots.shift())
  const immediate = vi.spyOn(globalThis, 'setImmediate')

  try {
    for (let index = 0; index < 3; index++) {
      await new Promise((resolve) => schedule(resolve))
    }
    expect(immediate).toHaveBeenCalledTimes(1)
  } finally {
    immediate.mockRestore()
  }
})

test('cooperative scheduling preserves AsyncLocalStorage across microtask and task yields', async () => {
  const storage = new AsyncLocalStorage()

  for (const budget of [Infinity, 0]) {
    const context = { budget }
    const schedule = createCooperativeScheduler(budget)
    await new Promise((resolve) =>
      storage.run(context, () =>
        schedule(() => {
          expect(storage.getStore()).toBe(context)
          resolve()
        }),
      ),
    )
  }
})

test('cooperative scheduling gives timers a turn during sustained work', async () => {
  const schedule = createCooperativeScheduler(1)
  let remaining = 100_000
  let completed = false
  let timerRanBeforeCompletion = false

  const work = new Promise((resolve) => {
    const step = () => {
      remaining -= 1
      if (remaining === 0) {
        completed = true
        resolve()
        return
      }
      schedule(step)
    }
    schedule(step)
  })
  const timer = new Promise((resolve) =>
    setTimeout(() => {
      timerRanBeforeCompletion = !completed
      resolve()
    }, 0),
  )

  await Promise.all([work, timer])
  expect(timerRanBeforeCompletion).toBe(true)
})

test('monotonic clock does not move backwards', () => {
  const first = monotonicNow()
  const second = monotonicNow()

  expect(Number.isFinite(first)).toBe(true)
  expect(second).toBeGreaterThanOrEqual(first)
})