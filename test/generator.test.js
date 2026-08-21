const { AsyncLocalStorage } = require('node:async_hooks')
const _ = require('../src')
const h = require('./helpers')

test('async exstream', async () => {
  async function* source() {
    for (let i = 0; i < 10; i++) {
      await h.sleep(0)
      yield i
    }
  }
  const sourceStream = _(source())
  const res = await sourceStream.tap(() => expect(sourceStream.paused).toBe(false)).toArray()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('async sources preserve AsyncLocalStorage across cooperative yields', async () => {
  const storage = new AsyncLocalStorage()
  const context = { traceId: 'cooperative-source' }
  let consumed = 0
  let contextMismatches = 0

  async function* source() {
    for (let index = 0; index < 20_000; index += 1) yield index
  }

  await storage.run(context, () =>
    _(source())
      .tap(() => {
        consumed += 1
        if (storage.getStore() !== context) contextMismatches += 1
      })
      .drain(),
  )

  expect(consumed).toBe(20_000)
  expect(contextMismatches).toBe(0)
})

test('generator backpressure', async () => {
  function* source() {
    for (let i = 0; i < 10; i++) yield i
  }
  const sourceStream = _(source())

  const res = await sourceStream
    .map(async (x) => {
      await h.sleep(10)
      expect(sourceStream.paused).toBe(true)
      return x
    })
    .mapAsync((value) => value)
    .toArray()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('recursive generator', async () => {
  function* gen(i = 0) {
    if (i > 10) return
    yield i
    yield* gen(i + 1)
  }

  const res = await _(gen()).toArray()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('switch source', async () => {
  function* gen() {
    yield* [0, 1, 2, 3, 4, 5]
    yield* [6, 7, 8, 9, 10]
  }

  const res = await _(gen()).toArray()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('switch source + backpressure', async () => {
  function* gen() {
    yield* [0, 1, 2, 3, 4, 5]
    yield* [6, 7, 8, 9, 10]
  }

  const res = []
  await _(gen()).pipeTo(h.getSlowWritable(res, 1, 0))

  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})