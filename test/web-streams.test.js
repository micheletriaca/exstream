const _ = require('../src/index.js')
const { deferred, nextTurn, waitFor } = require('./invariant-helpers.js')
const { kDestroy, kResume } = require('../src/stream-control.js')

test('a ReadableStream is consumed with transformations and source backpressure', async () => {
  let next = 0
  let pulls = 0
  const readable = new ReadableStream(
    {
      pull(controller) {
        pulls++
        if (next === 3) controller.close()
        else controller.enqueue(++next)
      },
    },
    { highWaterMark: 0 },
  )
  const source = _(readable)
  const iterator = source.map((value) => value * 10)[Symbol.asyncIterator]()

  expect(pulls).toBe(0)
  await expect(iterator.next()).resolves.toEqual({ done: false, value: 10 })
  expect(pulls).toBe(1)
  await expect(iterator.next()).resolves.toEqual({ done: false, value: 20 })
  expect(pulls).toBe(2)
  await expect(iterator.next()).resolves.toEqual({ done: false, value: 30 })
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  expect(pulls).toBe(4)
})

test('destroying a ReadableStream source cancels and unlocks its reader', async () => {
  let cancelReason
  const readable = new ReadableStream({
    pull() {},
    cancel(reason) {
      cancelReason = reason
    },
  })
  const source = _(readable)
  source[kResume]()

  source[kDestroy]()
  await nextTurn()

  expect(cancelReason.name).toBe('AbortError')
  expect(readable.locked).toBe(false)
})

test('a ReadableStream error becomes an Exstream record error', async () => {
  const reason = Error('web source failure')
  const errors = []
  const readable = new ReadableStream({
    start(controller) {
      controller.error(reason)
    },
  })

  const result = await _(readable)
    .errors((error) => errors.push(error))
    .toArray()

  expect(result).toEqual([])
  expect(errors).toEqual([reason])
})

test('toWebReadable exposes a pull-based transformed stream', async () => {
  const source = _([1, 2, 3])
    .map((value) => value * 10)
    .toWebReadable({ strategy: { highWaterMark: 0 } })
  const reader = source.getReader()

  await expect(reader.read()).resolves.toEqual({ done: false, value: 10 })
  await expect(reader.read()).resolves.toEqual({ done: false, value: 20 })
  await expect(reader.read()).resolves.toEqual({ done: false, value: 30 })
  await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  reader.releaseLock()
})

test('cancelling toWebReadable destroys the Exstream graph', async () => {
  const reason = Error('cancel web reader')
  const source = _([1, 2, 3])
  const readable = source.toWebReadable()
  const reader = readable.getReader()

  await reader.read()
  await reader.cancel(reason)

  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBe(reason)
})

test('cancelling toWebReadable without a reason returns the iterator cleanly', async () => {
  const source = _([1, 2, 3])
  const reader = source.toWebReadable().getReader()

  await reader.read()
  await reader.cancel()

  expect(source.state).toBe('destroyed')
})

test('toWebReadable forwards record errors to the reader', async () => {
  const reason = Error('record failure')
  const reader = _([1, reason]).toWebReadable().getReader()

  await expect(reader.read()).resolves.toEqual({ done: false, value: 1 })
  await expect(reader.read()).rejects.toBe(reason)
})

test('pipeTo accepts WritableStream and waits for each write', async () => {
  const releases = []
  const written = []
  let started = 0
  const writable = new WritableStream({
    write(value) {
      started++
      written.push(value)
      return new Promise((resolve) => releases.push(resolve))
    },
  })
  const source = _([1, 2, 3]).map((value) => value * 10)
  const result = source.pipeTo(writable)

  await waitFor(() => started === 1, 'first web write did not start')
  expect(written).toEqual([10])
  releases.shift()()
  await waitFor(() => started === 2, 'second web write did not start')
  expect(written).toEqual([10, 20])
  releases.shift()()
  await waitFor(() => started === 3, 'third web write did not start')
  releases.shift()()

  await expect(result).resolves.toBeUndefined()
  expect(written).toEqual([10, 20, 30])
})

test('pipeTo closes a WritableStream unless end is false', async () => {
  const closed = vi.fn()
  const writable = new WritableStream({ close: closed })

  await _([1]).pipeTo(writable)
  expect(closed).toHaveBeenCalledOnce()

  const leftOpen = new WritableStream({ close: closed })
  await _([1]).pipeTo(leftOpen, { end: false })
  expect(closed).toHaveBeenCalledOnce()
  expect(leftOpen.locked).toBe(false)
})

test('pipeTo can preserve a WritableStream with preventClose', async () => {
  const closed = vi.fn()
  const writable = new WritableStream({ close: closed })

  await _([1]).pipeTo(writable, { preventClose: true })

  expect(closed).not.toHaveBeenCalled()
  expect(writable.locked).toBe(false)
})

test('a WritableStream failure aborts the Exstream graph and destination', async () => {
  const reason = Error('web destination failure')
  const aborted = vi.fn()
  const writable = new WritableStream({
    abort: aborted,
    write() {
      throw reason
    },
  })
  const source = _([1, 2, 3])

  await expect(source.pipeTo(writable)).rejects.toBe(reason)
  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBe(reason)
  // A write failure errors the native WritableStream before Exstream can request abort.
  expect(aborted).not.toHaveBeenCalled()
  expect(writable.locked).toBe(false)
})

test('pipeTo external signal aborts Web Stream transfer', async () => {
  const controller = new AbortController()
  const reason = Error('cancel web pipe')
  const writing = deferred()
  const release = deferred()
  const aborted = vi.fn()
  const writable = new WritableStream({
    abort: aborted,
    write() {
      writing.resolve()
      return release.promise
    },
  })
  const source = _([1, 2, 3])
  const result = source.pipeTo(writable, { signal: controller.signal })

  await writing.promise
  controller.abort(reason)

  await expect(result).rejects.toBe(reason)
  expect(source.state).toBe('aborted')
  release.resolve()
  await waitFor(() => aborted.mock.calls.length === 1, 'web destination was not aborted')
  expect(aborted).toHaveBeenCalledWith(reason)
})

test('pipeTo preventAbort leaves cancellation of the WritableStream to its owner', async () => {
  const controller = new AbortController()
  const writing = deferred()
  const release = deferred()
  const aborted = vi.fn()
  const writable = new WritableStream({
    abort: aborted,
    write() {
      writing.resolve()
      return release.promise
    },
  })
  const result = _([1]).pipeTo(writable, {
    preventAbort: true,
    signal: controller.signal,
  })

  await writing.promise
  controller.abort(Error('owner managed cancellation'))

  await expect(result).rejects.toThrow('owner managed cancellation')
  release.resolve()
  await nextTurn()
  expect(aborted).not.toHaveBeenCalled()
})

test('reliable fan-out applies the slowest WritableStream backpressure to the source', async () => {
  let produced = 0
  const releases = []
  const fastValues = []
  const slowValues = []
  const source = _((write, next) => {
    if (produced === 3) write(_.nil)
    else {
      write(++produced)
      next()
    }
  })
  const slow = new WritableStream({
    write(value) {
      slowValues.push(value)
      return new Promise((resolve) => releases.push(resolve))
    },
  })
  const fast = new WritableStream({ write: (value) => fastValues.push(value) })
  const slowDone = source.fork(true).pipeTo(slow)
  const fastDone = source.fork(true).pipeTo(fast)

  await source.start()
  for (let value = 1; value <= 3; value++) {
    await waitFor(() => releases.length === value, `slow web sink did not receive item ${value}`)
    expect(produced).toBe(value)
    expect(fastValues).toEqual(Array.from({ length: value }, (_, index) => index + 1))
    releases[value - 1]()
  }

  await Promise.all([slowDone, fastDone])
  expect(slowValues).toEqual([1, 2, 3])
  expect(fastValues).toEqual(slowValues)
})

test('a fetch response body can flow through CSV and transformations to a WritableStream', async () => {
  const destination = []
  const response = new Response('id,name\n1,Ada\n2,Grace\n')
  const writable = new WritableStream({ write: (value) => destination.push(value) })

  await _(response.body)
    .csv({ header: true })
    .map((row) => Object.assign(row, { id: Number(row.id) }))
    .pipeTo(writable)

  expect(destination).toEqual([
    { id: 1, name: 'Ada' },
    { id: 2, name: 'Grace' },
  ])
})