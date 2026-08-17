vi.setConfig({ testTimeout: 2000 })

const { Writable } = require('stream')
const _ = require('../src/index.js')
const { waitFor } = require('./invariant-helpers.js')

const controlledConsumer = (stream) => {
  const releases = []
  const values = []
  const done = new Promise((resolve, reject) => {
    stream
      .consume((err, value, push, next) => {
        if (err) {
          push(err)
          next()
        } else if (value === _.nil) {
          push(null, _.nil)
        } else {
          values.push(value)
          releases.push(next)
        }
      })
      .once('error', reject)
      .once('end', resolve)
      .resume()
  })
  return { done, releases, values }
}

test('a slow reliable fork stops the source and bounds run-ahead', async () => {
  const total = 20
  let produced = 0
  const source = _((write, next) => {
    if (produced === total) {
      write(_.nil)
    } else {
      write(produced++)
      next()
    }
  })
  const fastValues = []
  const fastResult = source
    .fork(true)
    .tap((value) => fastValues.push(value))
    .toArray()
  const slow = controlledConsumer(source.fork(true))

  await source.start()

  for (let index = 0; index < total; index++) {
    await waitFor(() => slow.releases.length > index, `slow fork did not receive item ${index}`)
    expect(produced).toBe(index + 1)
    expect(fastValues).toHaveLength(index + 1)
    expect(slow.values).toHaveLength(index + 1)
    slow.releases[index]()
  }

  await slow.done
  expect(await fastResult).toEqual(Array.from({ length: total }, (_, index) => index))
  expect(slow.values).toEqual(fastValues)
  expect(produced).toBe(total)
})

test('a blocked observer does not slow the main flow', async () => {
  const total = 20
  let produced = 0
  const source = _((write, next) => {
    if (produced === total) {
      write(_.nil)
    } else {
      write(produced++)
      next()
    }
  })
  const callbacks = []
  const observedValues = []
  const observerWritable = new Writable({
    objectMode: true,
    highWaterMark: 1,
    write(value, encoding, callback) {
      observedValues.push(value)
      callbacks.push(callback)
    },
  })
  let observerFinished = false
  const observerDone = new Promise((resolve, reject) => {
    observerWritable
      .once('finish', () => {
        observerFinished = true
        resolve()
      })
      .once('error', reject)
  })
  source.observe().pipeTo(observerWritable)

  const mainResult = await source.toArray()

  expect(mainResult).toEqual(Array.from({ length: total }, (_, index) => index))
  expect(produced).toBe(total)
  expect(observerFinished).toBe(false)
  expect(observedValues.length).toBeLessThan(total)

  for (let index = 0; index < total; index++) {
    await waitFor(() => callbacks.length > index, `observer writer did not receive item ${index}`)
    callbacks[index]()
  }

  await observerDone
  expect(observedValues).toEqual(mainResult)
})