const _ = require('../src/index.js')
const h = require('./helpers.js')

test('ratelimit', async () => {
  const s = _(h.randomStringGenerator(Infinity)).ratelimit(2, 5)
  setTimeout(() => s.destroy(), 20)
  const res = await s.toArray()
  expect(res.length).toBeGreaterThanOrEqual(6)
  expect(res.length).toBeLessThanOrEqual(12)
})

test('generator slower than ratelimit', () =>
  new Promise((resolve) => {
    const res = []
    const s = _(
      (async function* () {
        while (true) {
          await h.sleep(10)
          yield '1'
        }
      })(),
    ).ratelimit(2, 10)
    s.pipeTo(h.getSlowWritable(res, 0, 20))
    setTimeout(() => {
      s.destroy()
      resolve()
      expect(res.length).toBeGreaterThanOrEqual(3)
      expect(res.length).toBeLessThanOrEqual(5)
    }, 50)
  }))

test('throttle is unaffected by wall-clock jumps', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const result = await _([1, 2])
      .tap((value) => {
        if (value === 2) vi.setSystemTime(new Date('2036-01-01T00:00:00Z'))
      })
      .throttle(1000)
      .toArray()

    expect(result).toEqual([1])
  } finally {
    vi.useRealTimers()
  }
})

test('abort clears a pending ratelimit timer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const reason = Error('abort rate limit')
    const limited = _([1, 2]).ratelimit(1, 1000)
    const result = limited.toArray()

    expect(vi.getTimerCount()).toBe(1)
    limited.abort(reason)

    await expect(result).rejects.toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
    expect(limited.state).toBe('aborted')
  } finally {
    vi.useRealTimers()
  }
})