const _ = require('../src/index.js')
const h = require('./helpers.js')

test('merging basics', async () => {
  const results = await _([_([1, 2]), _([3, 4])])
    .merge(1)
    .toArray()

  expect(results).toEqual([1, 2, 3, 4])
})

test('fork and merging - basics', async () => {
  const source = _([1, 2])
  const results = await _([source.fork().map((i) => i * 2), source.fork().map((i) => i * 3)])
    .merge()
    .toArray()

  expect(results).toEqual([2, 3, 4, 6])
})

test('fork and merging - preserve order', async () => {
  const source = _([1, 2], 'source')
  const results = await _(
    [source.fork().map((i) => i * 2), source.fork().map((i) => i * 3)],
    'merge',
  )
    .merge(2, true)
    .toArray()

  expect(results).toEqual([2, 4, 3, 6])
})

test('fork and merging with promises in first fork', async () => {
  const source = _([1, 2])
  const results = await _([
    source
      .fork()
      .map(async (i) => i * 2)
      .mapAsync((value) => value),
    source.fork().map((i) => i * 3),
  ])
    .merge(2, true)
    .toArray()

  expect(results).toEqual([2, 4, 3, 6])
})

test('fork and merging with promises in second fork', async () => {
  const source = _([1, 2])
  const results = await _([
    source.fork().map((i) => i * 2),
    source
      .fork()
      .map(async (i) => i * 3)
      .mapAsync((value) => value),
  ])
    .merge(2, true)
    .toArray()

  expect(results).toEqual([2, 4, 3, 6])
})

test('fork and merging - with toArray', async () => {
  const source = _([1, 2, 3, 4])
  const first = source.fork().map((i) => i * 2)
  const second = source.fork().map((i) => i * 3)
  const results = await _([first, second]).merge(2, true).toArray()
  expect(results).toEqual([2, 4, 6, 8, 3, 6, 9, 12])
})

test('fork and merging - promise in the source stream as well', async () => {
  const source = _([1, 2, 3, 4])
    .map(async (i) => i + 1)
    .mapAsync((value) => value)
  const first = source
    .fork()
    .map(async (i) => i * 2)
    .mapAsync((value) => value)
  const second = source
    .fork()
    .map(async (i) => i * 3)
    .mapAsync((value) => value)
  const results = await _([first, second]).merge(2, true).toArray()
  expect(results).toEqual([4, 6, 8, 10, 6, 9, 12, 15])
})

test('consuming fork in different "transactions" throw exception', async () => {
  const source = _([1, 2, 3])
  await (() => ({}))(await source.fork().toArray())
  await new Promise((resolve) => setTimeout(resolve, 50))

  let ex = null
  try {
    await (() => ({}))(
      await source
        .fork()
        .map((x) => x * 2)
        .toArray(),
    )
  } catch (e) {
    ex = e
  }

  expect(ex).not.toBe(null)
  expect(ex.message).toBe("this stream is already started. you can't fork it anymore")
})

test('consuming fork in different "transactions" with disable autostart', async () => {
  const source = _([1, 2, 3])
  const firstResult = source.fork(true).toArray()
  const secondResult = new Promise((resolve) => {
    setTimeout(async () => {
      await resolve(
        await source
          .fork()
          .map((x) => x * 2)
          .toArray(),
      )
      source.start()
    }, 10)
  })

  const [first, second] = await Promise.all([firstResult, secondResult])
  expect(first).toEqual([1, 2, 3])
  expect(second).toEqual([2, 4, 6])
})

test('consuming fork in setImmediate or nextTick works', async () => {
  const finished = vi.fn()
  const source = _([1, 2, 3])
  const directResult = source
    .fork()
    .toArray()
    .then((res) => {
      finished()
      return res
    })
  const nextTickResult = new Promise((resolve) => {
    process.nextTick(async () => {
      await ((res) => {
        finished()
        resolve(res)
      })(
        await source
          .fork()
          .map((x) => x * 2)
          .toArray(),
      )
    })
  })
  const immediateResult = new Promise((resolve) => {
    setImmediate(async () => {
      await ((res) => {
        finished()
        resolve(res)
      })(
        await source
          .fork()
          .map((x) => x * 2)
          .toArray(),
      )
    })
  })

  const [direct, nextTick, immediate] = await Promise.all([
    directResult,
    nextTickResult,
    immediateResult,
  ])
  expect(direct).toEqual([1, 2, 3])
  expect(nextTick).toEqual([2, 4, 6])
  expect(immediate).toEqual([2, 4, 6])
  expect(finished).toHaveBeenCalledTimes(3)
})

test('take() in a fork', async () => {
  const source = _([1, 2, 3, 4])
    .map(async (i) => i + 1)
    .mapAsync((value) => value)
  const results = await _([
    source
      .fork()
      .map(async (i) => i * 2)
      .mapAsync((value) => value),
    source
      .fork()
      .take(1)
      .map(async (i) => i * 3)
      .mapAsync((value) => value),
  ])
    .merge(2, true)
    .toArray()
  expect(results).toEqual([4, 6, 8, 10, 6])
})

test('merging1', async () => {
  const res = []
  const s = _([1, 2, 3])
  await _([
    s.fork().map((x) => x * 2 + 1),
    s.fork().map((x) => x * 2 + 2),
    s.fork().map((x) => x * 2 + 3),
  ])
    .merge(3, false)
    .pipeTo(h.getSlowWritable(res, 5))
  expect(res).toEqual([3, 4, 5, 5, 6, 7, 7, 8, 9])
})

test('merging3', async () => {
  let excep = false
  await _([1, 2])
    .merge()
    .toArray()
    .catch(() => {
      excep = true
    })
  expect(excep).toBe(true)
})

test('final through in a node writer is equivalent to calling pipe', async () => {
  const res = []
  await new Promise((resolve) => {
    _([1, 2, 3])
      .through(h.getSlowWritable(res, 0, 0), { writable: true })
      .on('finish', resolve)
  })

  expect(res).toEqual([1, 2, 3])
})

/* Merge a stream of streams piped in a writable node stream, controlling the speed with merge */
test('merge a stream of streams', async () => {
  const res = []
  await _([
    [1, 2, 3],
    [4, 5, 6],
  ])
    .map((x) => _(x).through(h.getSlowWritable(res, 0, 0), { writable: true }))
    .merge(1)
    .toArray()
  expect(res).toEqual([1, 2, 3, 4, 5, 6])
})

test('writable streams cannot be wrapped in an exstream instance', async () => {
  let ex = null
  await _(h.getSlowWritable([], 0, 0))
    .toArray()
    .catch((e) => void (ex = e))
  expect(ex).not.toBe(null)
})

test('complex control flow with through, fork, merge and writable', async () => {
  const res = []
  const res2 = []
  const res3 = []
  const s = _([1, 2, 3])

  const p1 = _()
    .map((x) => x * 2)
    .through(h.getSlowWritable(res, 0, 0), { writable: true })
  const p2 = _.pipeline()
    .map((x) => x * 2)
    .through(h.getSlowWritable(res3, 0, 0), { writable: true })

  await _([
    s.fork().through(p1, { writable: true }),
    s.fork().through(p2, { writable: true }),
    s.fork().through(h.getSlowWritable(res2, 0, 0), { writable: true }),
  ])
    .merge()
    .toArray()

  expect(res).toEqual([2, 4, 6])
  expect(res3).toEqual([2, 4, 6])
  expect(res2).toEqual([1, 2, 3])
})