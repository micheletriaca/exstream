const { Readable, Writable } = require('stream')
const _ = require('../src/index.js')
const { waitFor } = require('./invariant-helpers.js')

const collectingWritable = (values) =>
  new Writable({
    highWaterMark: 1,
    objectMode: true,
    write(value, encoding, callback) {
      setImmediate(() => {
        values.push(value)
        callback()
      })
    },
  })

test('pipeTo writes with backpressure and resolves only after the Node destination finishes', async () => {
  const values = []
  const destination = collectingWritable(values)

  await expect(_([1, 2, 3]).pipeTo(destination)).resolves.toBeUndefined()

  expect(values).toEqual([1, 2, 3])
  expect(destination.writableFinished).toBe(true)
})

test('pipeTo rejects an unhandled record error and does not finish partial output', async () => {
  const reason = Error('bad record')
  const values = []
  const destination = collectingWritable(values)

  const result = _([1, 2, 3])
    .map((value) => {
      if (value === 2) throw reason
      return value
    })
    .pipeTo(destination)

  await expect(result).rejects.toBe(reason)
  expect(values).toEqual([1])
  expect(destination.destroyed).toBe(true)
  expect(destination.writableFinished).toBe(false)
  expect(_.errorInfo(reason)).toMatchObject({
    input: 2,
    origin: 'operator',
    stage: 'map',
  })
})

test('pipeTo succeeds when record errors are explicitly handled upstream', async () => {
  const reason = Error('skipped record')
  const values = []
  const destination = collectingWritable(values)

  await _([1, reason, 3]).skipErrors().pipeTo(destination)

  expect(values).toEqual([1, 3])
  expect(destination.writableFinished).toBe(true)
})

test('pipeTo identifies Node reader failures as source errors', async () => {
  const reason = Error('reader failed')
  const input = new Readable({
    objectMode: true,
    read() {
      this.push(1)
      this.destroy(reason)
    },
  })
  const destination = collectingWritable([])

  await expect(_(input).pipeTo(destination)).rejects.toBe(reason)

  expect(_.errorInfo(reason)).toMatchObject({ origin: 'source', stage: 'read' })
  expect(destination.destroyed).toBe(true)
  expect(destination.writableFinished).toBe(false)
})

test('pipeTo identifies Node writer failures as sink errors', async () => {
  const reason = Error('writer failed')
  const destination = new Writable({
    objectMode: true,
    write(value, encoding, callback) {
      callback(reason)
    },
  })

  await expect(_([1, 2, 3]).pipeTo(destination)).rejects.toBe(reason)

  expect(_.errorInfo(reason)).toMatchObject({ origin: 'sink', stage: 'write' })
})

test('a pipeTo sink failure aborts only its fork while reliable siblings continue', async () => {
  const reason = Error('one destination failed')
  const source = _([1, 2, 3])
  const failed = source.fork(true)
  const sibling = source.fork(true)
  const destination = new Writable({
    objectMode: true,
    write(value, encoding, callback) {
      callback(reason)
    },
  })

  const failedResult = failed.pipeTo(destination)
  const siblingResult = sibling.toPromise()
  await source.start()

  await expect(failedResult).rejects.toBe(reason)
  await expect(siblingResult).resolves.toEqual([1, 2, 3])
  expect(failed.state).toBe('aborted')
  expect(source.state).toBe('ended')
})

test('pipeTo aborts a Node transfer through its external signal', async () => {
  const controller = new AbortController()
  const reason = Error('cancel transfer')
  const destination = collectingWritable([])
  const source = _(null)
  const result = source.pipeTo(destination, { signal: controller.signal })

  controller.abort(reason)

  await expect(result).rejects.toBe(reason)
  expect(_.errorInfo(reason)).toMatchObject({ origin: 'lifecycle', stage: 'abort' })
  expect(source.state).toBe('aborted')
  expect(destination.destroyed).toBe(true)
})

test('pipeTo supports Web WritableStreams with the same strict terminal contract', async () => {
  const values = []
  const destination = new WritableStream({ write: (value) => values.push(value) })

  await expect(_([1, 2]).pipeTo(destination)).resolves.toBeUndefined()
  expect(values).toEqual([1, 2])
  expect(destination.locked).toBe(false)
})

test('pipeTo with end disabled waits for accepted writes without closing the destination', async () => {
  const values = []
  const destination = collectingWritable(values)

  await _([1, 2]).pipeTo(destination, { end: false })

  expect(values).toEqual([1, 2])
  expect(destination.writableEnded).toBe(false)
  destination.destroy()
})

test('pipeTo preventClose keeps a successful Node destination open', async () => {
  const values = []
  const destination = collectingWritable(values)

  await _([1]).pipeTo(destination, { preventClose: true })

  expect(values).toEqual([1])
  expect(destination.writableEnded).toBe(false)
  destination.destroy()
})

test('pipeTo with end disabled waits for writes accepted into the destination buffer', async () => {
  const callbacks = []
  const values = []
  const destination = new Writable({
    highWaterMark: 100,
    objectMode: true,
    write(value, encoding, callback) {
      values.push(value)
      callbacks.push(callback)
    },
  })
  let completed = false
  const result = _([1, 2])
    .pipeTo(destination, { end: false })
    .then(() => {
      completed = true
      return undefined
    })

  await waitFor(() => callbacks.length === 1, 'first buffered write did not start')
  expect(completed).toBe(false)
  callbacks.shift()()
  await waitFor(() => callbacks.length === 1, 'second buffered write did not start')
  expect(completed).toBe(false)
  callbacks.shift()()
  await result

  expect(values).toEqual([1, 2])
  expect(destination.writableEnded).toBe(false)
  destination.destroy()
})

test('pipeTo reports callback failures from a destination left open with end disabled', async () => {
  const reason = Error('borrowed destination failed')
  const destination = new Writable({
    objectMode: true,
    write(value, encoding, callback) {
      callback(reason)
    },
  })

  await expect(_([1]).pipeTo(destination, { end: false })).rejects.toBe(reason)
  expect(_.errorInfo(reason)).toMatchObject({ origin: 'sink', stage: 'write' })
})

test('pipeTo preventAbort leaves a Node destination owned by its caller', async () => {
  const reason = Error('upstream failure')
  const destination = collectingWritable([])

  await expect(_([reason]).pipeTo(destination, { preventAbort: true })).rejects.toBe(reason)

  expect(destination.destroyed).toBe(false)
  destination.destroy()
})

test('pipeTo removes every listener it installs on a Node destination', async () => {
  const destination = collectingWritable([])
  const events = ['close', 'drain', 'error', 'finish']
  const sentinels = Object.fromEntries(events.map((event) => [event, () => undefined]))
  for (const event of events) destination.on(event, sentinels[event])
  const baseline = Object.fromEntries(
    events.map((event) => [event, destination.listenerCount(event)]),
  )

  await _([1, 2]).pipeTo(destination)

  expect(
    Object.fromEntries(events.map((event) => [event, destination.listenerCount(event)])),
  ).toEqual(baseline)
  for (const event of events) destination.off(event, sentinels[event])
})

test.each([[], 1])('pipeTo rejects invalid options: %j', async (options) => {
  const destination = collectingWritable([])

  await expect(_([1]).pipeTo(destination, options)).rejects.toThrow('options must be an object')
  destination.destroy()
})

test('pipeTo supports standalone direct and curried forms', async () => {
  const directValues = []
  const curriedValues = []
  const explicitValues = []

  await _.pipeTo(collectingWritable(directValues), _([1, 2]))
  await _.pipeTo(collectingWritable(curriedValues))(_([3, 4]))
  await _.pipeTo(collectingWritable(explicitValues), { end: true }, _([5, 6]))

  expect(directValues).toEqual([1, 2])
  expect(curriedValues).toEqual([3, 4])
  expect(explicitValues).toEqual([5, 6])
})

test.each([null, {}, { aborted: false, addEventListener() {}, removeEventListener: 1 }])(
  'pipeTo rejects invalid signals: %j',
  async (signal) => {
    const destination = collectingWritable([])

    await expect(_([1]).pipeTo(destination, { signal })).rejects.toThrow(
      'signal must be an AbortSignal',
    )
    destination.destroy()
  },
)

test('pipeTo rejects invalid destinations', async () => {
  await expect(_([1]).pipeTo(null)).rejects.toThrow(
    'destination must be a Node writable or WritableStream',
  )
})

test('pipeTo classifies a synchronous write failure as a sink error', async () => {
  const reason = Error('synchronous write failure')
  const destination = collectingWritable([])
  destination.write = () => {
    throw reason
  }

  await expect(_([1]).pipeTo(destination)).rejects.toBe(reason)
  expect(_.errorInfo(reason)).toMatchObject({ origin: 'sink', stage: 'write' })
})

test('pipeTo classifies a synchronous close failure as a sink error', async () => {
  const reason = Error('synchronous close failure')
  const destination = collectingWritable([])
  destination.end = () => {
    throw reason
  }

  await expect(_([1]).pipeTo(destination)).rejects.toBe(reason)
  expect(_.errorInfo(reason)).toMatchObject({ origin: 'sink', stage: 'close' })
})

test('pipeTo rejects when a destination completes before its source', async () => {
  const source = _(null)
  const destination = collectingWritable([])
  const result = source.pipeTo(destination)

  destination.end()

  await expect(result).rejects.toMatchObject({
    code: 'EXSTREAM_DESTINATION_CLOSED',
    exstreamInfo: { origin: 'sink', stage: 'write' },
  })
  expect(source.state).toBe('aborted')
})

test('pipeTo handles a signal that was already aborted', async () => {
  const controller = new AbortController()
  const reason = Error('already cancelled')
  controller.abort(reason)
  const destination = collectingWritable([])

  await expect(_([1]).pipeTo(destination, { signal: controller.signal })).rejects.toBe(reason)
  expect(destination.destroyed).toBe(true)
})

test('pipeTo classifies Web destination failures without overwriting upstream provenance', async () => {
  const sinkReason = Error('web sink failure')
  const sink = new WritableStream({
    write() {
      throw sinkReason
    },
  })
  await expect(_([1]).pipeTo(sink)).rejects.toBe(sinkReason)
  expect(_.errorInfo(sinkReason)).toMatchObject({ origin: 'sink', stage: 'write' })

  const upstreamReason = Error('web upstream failure')
  const upstream = new WritableStream()
  await expect(
    _([1])
      .map(() => {
        throw upstreamReason
      })
      .pipeTo(upstream),
  ).rejects.toBe(upstreamReason)
  expect(_.errorInfo(upstreamReason)).toMatchObject({ origin: 'operator', stage: 'map' })
})