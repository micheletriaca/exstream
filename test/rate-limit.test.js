const _ = require('../src/index.js')
const { kAbort } = require('../src/stream-control.js')

test('rateLimit emits one burst per window and backpressures while waiting', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let now = 0
  const clock = vi.spyOn(globalThis.performance, 'now').mockImplementation(() => now)
  const pulled = []
  const emitted = []

  function* values() {
    for (const value of [1, 2, 3, 4]) {
      pulled.push(value)
      yield value
    }
  }

  try {
    const result = _(values())
      .rateLimit({ limit: 2, interval: 100 })
      .tap((value) => emitted.push([value, now]))
      .toArray()

    expect(pulled).toEqual([1, 2, 3])
    expect(emitted).toEqual([
      [1, 0],
      [2, 0],
    ])
    expect(vi.getTimerCount()).toBe(1)

    now = 99
    vi.advanceTimersByTime(100)
    expect(emitted).toEqual([
      [1, 0],
      [2, 0],
    ])
    expect(vi.getTimerCount()).toBe(1)

    now = 100
    vi.advanceTimersByTime(1)

    await expect(result).resolves.toEqual([1, 2, 3, 4])
    expect(emitted).toEqual([
      [1, 0],
      [2, 0],
      [3, 100],
      [4, 100],
    ])
    expect(pulled).toEqual([1, 2, 3, 4])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    clock.mockRestore()
    vi.useRealTimers()
  }
})

test('rateLimit starts a fresh window after an idle interval', async () => {
  const clock = vi.spyOn(globalThis.performance, 'now')
  const emitted = []
  try {
    clock.mockReturnValueOnce(0).mockReturnValueOnce(150).mockReturnValue(150)

    const result = await _([1, 2, 3])
      .rateLimit({ limit: 2, interval: 100 })
      .tap((value) => emitted.push(value))
      .toArray()

    expect(result).toEqual([1, 2, 3])
    expect(emitted).toEqual([1, 2, 3])
  } finally {
    clock.mockRestore()
  }
})

test('rateLimit forwards record errors without consuming the successful-value quota', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const errors = []
  try {
    const result = await _([1, 2, 3])
      .map((value) => {
        if (value === 2) throw Error('invalid record')
        return value
      })
      .rateLimit({ limit: 2, interval: 1000 })
      .errors((error) => errors.push(error))
      .toArray()

    expect(result).toEqual([1, 3])
    expect(errors.map((error) => error.message)).toEqual(['invalid record'])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

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

test('abort clears a pending rateLimit timer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const reason = Error('abort rate limit')
    const limited = _([1, 2]).rateLimit({ limit: 1, interval: 1000 })
    const result = limited.toArray()

    expect(vi.getTimerCount()).toBe(1)
    limited[kAbort](reason)

    await expect(result).rejects.toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
    expect(limited.state).toBe('aborted')
  } finally {
    vi.useRealTimers()
  }
})