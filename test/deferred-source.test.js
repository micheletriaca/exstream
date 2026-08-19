const { Readable } = require('node:stream')
const _ = require('../src/index.js')
const { nextTurn } = require('./invariant-helpers.js')

test('defer materializes a source once and only after downstream demand', async () => {
  const factory = vi.fn(() => [1, 2, 3])
  const source = _.defer(factory).map((value) => value * 2)

  expect(factory).not.toHaveBeenCalled()
  await expect(source.toArray()).resolves.toEqual([2, 4, 6])
  expect(factory).toHaveBeenCalledOnce()
})

test('defer awaits asynchronous source acquisition', async () => {
  const factory = vi.fn(async () => {
    await Promise.resolve()
    return (async function* () {
      yield 1
      yield 2
    })()
  })

  await expect(_.defer(factory).toArray()).resolves.toEqual([1, 2])
  expect(factory).toHaveBeenCalledOnce()
})

test('defer accepts an Exstream returned by its factory', async () => {
  await expect(_.defer(() => _([1, 2])).toArray()).resolves.toEqual([1, 2])
})

test('deferred factory failures retain source provenance', async () => {
  const reason = Error('source acquisition failed')
  const result = _.defer(() => {
    throw reason
  }).toArray()

  await expect(result).rejects.toBe(reason)
  expect(_.errorInfo(reason)).toMatchObject({ origin: 'source', stage: 'defer' })
})

test('defer rejects factories that do not return stream sources', async () => {
  await expect(_.defer(() => 42).toArray()).rejects.toThrow(
    'defer() factory must return a valid stream source',
  )
})

test('cancellation before demand does not invoke a deferred factory', () => {
  const controller = new AbortController()
  const reason = Error('cancelled before activation')
  controller.abort(reason)
  const factory = vi.fn(() => [1])
  const source = _.defer(factory, { signal: controller.signal })

  expect(source.state).toBe('aborted')
  expect(factory).not.toHaveBeenCalled()
})

test('manual activation supports forks registered in different turns after transforms', async () => {
  const iterator = vi.fn(() => [1, 2, 3][Symbol.iterator]())
  const input = { [Symbol.iterator]: iterator }
  const source = _(input, { start: 'manual' }).map((value) => value + 1)
  const first = source.fork().toArray()

  await nextTurn()
  expect(iterator).not.toHaveBeenCalled()

  const second = source
    .fork()
    .map((value) => value * 2)
    .toArray()
  await source.start()

  await expect(Promise.all([first, second])).resolves.toEqual([
    [2, 3, 4],
    [4, 6, 8],
  ])
  expect(iterator).toHaveBeenCalledOnce()
})

test('fork no longer accepts the legacy autostart boolean', () => {
  const source = _([1])
  expect(() => source.fork(true)).toThrow(
    "fork() does not accept arguments; use { start: 'manual' } on the source",
  )
})

test('start freezes reliable fork registration even before demand exists', async () => {
  const source = _([1], { start: 'manual' })
  await source.start()

  expect(() => source.fork()).toThrow("this stream is already started. you can't fork it anymore")
})

test('invalid start modes are rejected', () => {
  expect(() => _([1], { start: 'later' })).toThrow('start must be one of: auto, manual')
})

test('iterable, async iterable, Web, and Node adapters are acquired on demand', async () => {
  const syncIterator = vi.fn(() => [1][Symbol.iterator]())
  const asyncIterator = vi.fn(() =>
    (async function* () {
      yield 2
    })(),
  )
  const web = new ReadableStream({
    start(controller) {
      controller.enqueue(3)
      controller.close()
    },
  })
  const node = Readable.from([4])

  const sources = [
    _({ [Symbol.iterator]: syncIterator }, { start: 'manual' }),
    _({ [Symbol.asyncIterator]: asyncIterator }, { start: 'manual' }),
    _(web, { start: 'manual' }),
    _(node, { start: 'manual' }),
  ]
  const results = sources.map((source) => source.toArray())

  expect(syncIterator).not.toHaveBeenCalled()
  expect(asyncIterator).not.toHaveBeenCalled()
  expect(web.locked).toBe(false)
  expect(node.listenerCount('data')).toBe(0)

  await Promise.all(sources.map((source) => source.start()))
  await expect(Promise.all(results)).resolves.toEqual([[1], [2], [3], [4]])
  expect(syncIterator).toHaveBeenCalledOnce()
  expect(asyncIterator).toHaveBeenCalledOnce()
})