vi.setConfig({ testTimeout: 2000 })

const { finished } = require('stream/promises')
const { Writable } = require('stream')
const _ = require('../src/index.js')
const { nextTurn, waitFor } = require('./invariant-helpers.js')

const listenerSnapshot = (emitter, events) =>
  Object.fromEntries(events.map((event) => [event, emitter.listenerCount(event)]))

const writableWithSentinels = () => {
  const destination = new Writable({
    objectMode: true,
    write(value, encoding, callback) {
      setImmediate(callback)
    },
  })
  const events = ['close', 'drain', 'error', 'finish']
  const sentinels = Object.fromEntries(events.map((event) => [event, () => undefined]))
  for (const event of events) destination.on(event, sentinels[event])
  return {
    destination,
    events,
    removeSentinels() {
      for (const event of events) destination.off(event, sentinels[event])
    },
  }
}

test('pipeTo removes every listener it installs on a destination', async () => {
  const { destination, events, removeSentinels } = writableWithSentinels()
  const baseline = listenerSnapshot(destination, events)

  await _([1, 2, 3]).pipeTo(destination)
  await nextTurn()

  expect(listenerSnapshot(destination, events)).toEqual(baseline)
  removeSentinels()
})

test('destroying a destination early aborts its source and removes pipeTo listeners', async () => {
  let close
  const closed = new Promise((resolve) => {
    close = resolve
  })
  const destination = new Writable({
    objectMode: true,
    highWaterMark: 1,
    write() {
      this.destroy()
    },
  })
  const events = ['close', 'drain', 'error', 'finish']
  destination.on('close', close)
  const baseline = listenerSnapshot(destination, events)
  let produced = 0
  const source = _((write, next) => {
    write(produced++)
    next()
  })

  const transfer = source.pipeTo(destination)
  await closed
  await expect(transfer).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
  await nextTurn()

  expect(source.state).toBe('aborted')
  expect(produced).toBe(1)
  expect(listenerSnapshot(destination, events)).toEqual(baseline)
  destination.off('close', close)
})

test('pipeTo with end disabled releases destination listeners when its source ends', async () => {
  const { destination, events, removeSentinels } = writableWithSentinels()
  const baseline = listenerSnapshot(destination, events)
  const source = _([1, 2, 3])

  await source.pipeTo(destination, { end: false })
  await nextTurn()

  expect(destination.writableEnded).toBe(false)
  expect(listenerSnapshot(destination, events)).toEqual(baseline)
  removeSentinels()
  destination.destroy()
})

test('through writable removes every listener it installs on a destination', async () => {
  const { destination, events, removeSentinels } = writableWithSentinels()
  const baseline = listenerSnapshot(destination, events)

  _([1, 2, 3]).through(destination, { writable: true })
  await finished(destination, { cleanup: true })
  await nextTurn()
  await nextTurn()

  expect(listenerSnapshot(destination, events)).toEqual(baseline)
  removeSentinels()
})

test('fork and merge release stream listeners after completion', async () => {
  const source = _([1, 2, 3, 4])
  const first = source.fork().map((value) => value * 2)
  const second = source.fork().map((value) => value * 3)
  const merged = _([first, second]).merge(2, false)

  expect(await merged.toArray()).toHaveLength(8)
  await nextTurn()

  for (const stream of [source, first, second, merged]) {
    expect(stream.ended).toBe(true)
    expect(stream.eventNames()).toEqual([])
  }
})

test('destroy prevents pending mapAsync work from starting more tasks', async () => {
  const started = []
  const releases = []
  const received = []
  const resolved = _([0, 1, 2, 3, 4, 5])
    .map(
      (value) =>
        new Promise((resolve) => {
          started.push(value)
          releases.push(() => resolve(value))
        }),
    )
    .mapAsync((value) => value, { concurrency: 2, ordered: false })
  resolved
    .consumeSync((err, value, push) => {
      if (err) push(err)
      else if (value === _.nil) push(null, _.nil)
      else received.push(value)
    })
    .resume()

  await waitFor(() => started.length === 2, 'mapAsync() did not fill its initial window')
  resolved.destroy()
  for (const release of releases) release()
  await nextTurn()
  await nextTurn()

  expect(started).toEqual([0, 1])
  expect(received).toEqual([])
  expect(resolved.ended).toBe(true)
  expect(resolved.eventNames()).toEqual([])
})

test('destroy clears a pending ratelimit timer', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const limited = _([1, 2]).ratelimit(1, 1000)
    limited.resume()

    expect(vi.getTimerCount()).toBe(1)
    limited.destroy()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

test('destroy cancels a pending makeAsync turn', () => {
  vi.useFakeTimers({ toFake: ['setImmediate', 'clearImmediate'] })
  const clock = vi.spyOn(globalThis.performance, 'now')
  clock.mockReturnValueOnce(0).mockReturnValueOnce(1)
  try {
    const asynchronous = _([1, 2]).makeAsync(0)
    asynchronous.resume()

    expect(vi.getTimerCount()).toBe(1)
    asynchronous.destroy()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    clock.mockRestore()
    vi.useRealTimers()
  }
})