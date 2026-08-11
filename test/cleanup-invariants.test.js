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

test('pipe removes every listener it installs on a destination', async () => {
  const { destination, events, removeSentinels } = writableWithSentinels()
  const baseline = listenerSnapshot(destination, events)

  _([1, 2, 3]).pipe(destination)
  await finished(destination, { cleanup: true })
  await nextTurn()

  expect(listenerSnapshot(destination, events)).toEqual(baseline)
  removeSentinels()
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

  expect(await merged.toPromise()).toHaveLength(8)
  await nextTurn()

  for (const stream of [source, first, second, merged]) {
    expect(stream.ended).toBe(true)
    expect(stream.eventNames()).toEqual([])
  }
})

test('destroy prevents pending resolve work from starting more tasks', async () => {
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
    .resolve(2, false)
  resolved
    .consumeSync((err, value, push) => {
      if (err) push(err)
      else if (value === _.nil) push(null, _.nil)
      else received.push(value)
    })
    .resume()

  await waitFor(() => started.length === 2, 'resolve() did not fill its initial window')
  resolved.destroy()
  for (const release of releases) release()
  await nextTurn()
  await nextTurn()

  expect(started).toEqual([0, 1])
  expect(received).toEqual([])
  expect(resolved.ended).toBe(true)
  expect(resolved.eventNames()).toEqual([])
})