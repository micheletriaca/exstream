const _ = require('../src/index.js')
const { deferred, nextTurn } = require('./invariant-helpers.js')
const { kFail } = require('../src/stream-control.js')

test('Symbol.asyncIterator returns a self-iterable pull-based async iterator', async () => {
  const iterator = _([1, 2, 3])[Symbol.asyncIterator]()

  expect(iterator[Symbol.asyncIterator]()).toBe(iterator)
  expect(await iterator.next()).toEqual({ done: false, value: 1 })
  expect(await iterator.next()).toEqual({ done: false, value: 2 })
  expect(await iterator.next()).toEqual({ done: false, value: 3 })
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
})

test('Exstream supports for-await-of directly', async () => {
  const values = []

  for await (const value of _([1, 2, 3])) values.push(value * 10)

  expect(values).toEqual([10, 20, 30])
})

test('async iteration serializes concurrent next calls without reading ahead', async () => {
  const iterator = _([1, 2, 3])[Symbol.asyncIterator]()

  await expect(Promise.all([iterator.next(), iterator.next(), iterator.next()])).resolves.toEqual([
    { done: false, value: 1 },
    { done: false, value: 2 },
    { done: false, value: 3 },
  ])
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
})

test('async iteration pulls exactly one generator record per next call', async () => {
  let produced = 0
  const source = _((write, next) => {
    produced++
    write(produced)
    if (produced === 3) write(_.nil)
    else next()
  })
  const iterator = source[Symbol.asyncIterator]()

  await nextTurn()
  expect(produced).toBe(0)

  await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
  expect(produced).toBe(1)
  await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 })
  expect(produced).toBe(2)
  await expect(iterator.next()).resolves.toEqual({ done: false, value: 3 })
  expect(produced).toBe(3)
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
})

test('return releases an iterator branch and cancels its active record context', async () => {
  let signal
  const source = _([1, 2, 3]).map((value, context) => {
    signal = context.signal
    return value
  })
  const iterator = source[Symbol.asyncIterator]()

  await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
  await expect(iterator.return('finished')).resolves.toEqual({ done: true, value: 'finished' })

  expect(signal.aborted).toBe(true)
  expect(signal.reason.name).toBe('AbortError')
  expect(source.state).toBe('destroyed')
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
})

test('breaking from for-await-of releases the source', async () => {
  const source = _([1, 2, 3])

  for await (const value of source) {
    expect(value).toBe(1)
    break
  }

  expect(source.state).toBe('destroyed')
})

test('a record error rejects iteration and closes the iterator branch', async () => {
  const reason = Error('record failure')
  const iterator = _([1, reason, 2])[Symbol.asyncIterator]()

  await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
  await expect(iterator.next()).rejects.toBe(reason)
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
})

test('a fatal graph failure rejects a pending iterator read with the same reason', async () => {
  const reason = Error('fatal source')
  const source = _()
  const iterator = source[Symbol.asyncIterator]()
  const pending = iterator.next()

  source[kFail](reason, 'input')

  await expect(pending).rejects.toBe(reason)
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  expect(source.state).toBe('aborted')
})

test('an external signal aborts a pending iterator read and releases the source', async () => {
  const controller = new AbortController()
  const reason = Error('cancel iterator')
  const started = deferred()
  const source = _(
    async () => {
      started.resolve()
      await new Promise(() => {})
    },
    { signal: controller.signal },
  )
  const iterator = source[Symbol.asyncIterator]()
  const pending = iterator.next()

  await started.promise
  controller.abort(reason)

  await expect(pending).rejects.toBe(reason)
  expect(source.state).toBe('aborted')
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
})

test('a pre-aborted signal prevents the iterator source from starting', async () => {
  const controller = new AbortController()
  const reason = Error('already aborted')
  const sourceStarted = vi.fn()
  controller.abort(reason)
  const iterator = _(async () => sourceStarted(), {
    signal: controller.signal,
  })[Symbol.asyncIterator]()

  await expect(iterator.next()).rejects.toBe(reason)
  expect(sourceStarted).not.toHaveBeenCalled()
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
})

test('throw aborts the iterator branch and rejects with the supplied reason', async () => {
  const reason = Error('consumer failure')
  const source = _()
  const iterator = source[Symbol.asyncIterator]()

  await expect(iterator.throw(reason)).rejects.toBe(reason)
  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBe(reason)
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
})

test('return resolves a pending read and does not leave the source active', async () => {
  const source = _()
  const iterator = source[Symbol.asyncIterator]()
  const pending = iterator.next()

  await iterator.return()

  await expect(pending).resolves.toEqual({ done: true, value: undefined })
  expect(source.state).toBe('destroyed')
})

test('async iteration removes an external abort listener after normal completion', async () => {
  const controller = new AbortController()
  const iterator = _([1], { signal: controller.signal })[Symbol.asyncIterator]()

  await iterator.next()
  await iterator.next()
  controller.abort(Error('late abort'))
  await nextTurn()

  expect(await iterator.next()).toEqual({ done: true, value: undefined })
})