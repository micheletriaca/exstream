vi.setConfig({ testTimeout: 5000 })

const { finished } = require('stream/promises')
const { Writable } = require('stream')
const _ = require('../src/index.js')
const { kDestroy } = require('../src/stream-control.js')
const { nextTurn, waitFor } = require('./invariant-helpers.js')

test('reliable fan-out remains bounded with a slow writer over many records', async () => {
  const total = 1000
  let produced = 0
  let completedWrites = 0
  let maxPendingWrites = 0
  const slowValues = []
  const fastValues = []
  const source = _(
    (write, next) => {
      if (produced === total) {
        write(_.nil)
      } else {
        write(produced++)
        next()
      }
    },
    { start: 'manual' },
  )
  const slowWriter = new Writable({
    objectMode: true,
    highWaterMark: 1,
    write(value, encoding, callback) {
      slowValues.push(value)
      maxPendingWrites = Math.max(maxPendingWrites, produced - completedWrites)
      setImmediate(() => {
        completedWrites++
        callback()
      })
    },
  })
  const slowDone = finished(slowWriter, { cleanup: true })
  source.fork().pipeTo(slowWriter)
  const fastResult = source
    .fork()
    .tap((value) => fastValues.push(value))
    .toArray()

  await source.start()
  await slowDone

  const expected = Array.from({ length: total }, (_, index) => index)
  expect(await fastResult).toEqual(expected)
  expect(slowValues).toEqual(expected)
  expect(fastValues).toEqual(expected)
  expect(maxPendingWrites).toBe(1)
})

test('a late transform error drains through a backpressured writer without data loss', async () => {
  const total = 500
  const errorIndex = total - 10
  const errors = []
  const written = []
  const destination = new Writable({
    objectMode: true,
    highWaterMark: 1,
    write(value, encoding, callback) {
      written.push(value)
      setImmediate(callback)
    },
  })
  const destinationDone = finished(destination, { cleanup: true })

  _(Array.from({ length: total }, (_, index) => index))
    .map((value) => {
      if (value === errorIndex) throw Error('late failure')
      return value
    })
    .errors((error) => errors.push(error))
    .pipeTo(destination)

  await destinationDone

  expect(errors).toHaveLength(1)
  expect(errors[0].message).toBe('late failure')
  expect(errors[0].exstreamInput).toBe(errorIndex)
  expect(written).toEqual(
    Array.from({ length: total }, (_, index) => index).filter((value) => value !== errorIndex),
  )
})

test('destroy terminates a backpressured fork/merge graph without later activity', async () => {
  let produced = 0
  const callbacks = []
  const destination = new Writable({
    objectMode: true,
    highWaterMark: 1,
    write(value, encoding, callback) {
      callbacks.push(callback)
    },
  })
  const destinationDone = finished(destination, { cleanup: true })
  const source = _(
    (write, next) => {
      write(produced++)
      next()
    },
    { start: 'manual' },
  )
  const first = source.fork().map((value) => `a${value}`)
  const second = source.fork().map((value) => `b${value}`)
  const merged = _([first, second]).merge(2, false)
  merged.pipeTo(destination)

  await source.start()
  await waitFor(() => callbacks.length === 1, 'destination did not apply backpressure')
  merged[kDestroy]()
  const producedAtDestroy = produced
  callbacks[0]()

  await destinationDone
  await nextTurn()
  await nextTurn()

  expect(produced).toBe(producedAtDestroy)
  for (const stream of [source, first, second, merged]) {
    expect(stream.ended).toBe(true)
    expect(stream.eventNames()).toEqual([])
  }
})

test('repeated fork/merge lifecycles do not accumulate listeners', async () => {
  for (let iteration = 0; iteration < 100; iteration++) {
    const source = _([1, 2, 3])
    const first = source.fork().map((value) => value * 2)
    const second = source.fork().map((value) => value * 3)
    const merged = _([first, second]).merge(2, false)

    expect(await merged.toArray()).toHaveLength(6)
    for (const stream of [source, first, second, merged]) {
      expect(stream.eventNames()).toEqual([])
    }
  }
})