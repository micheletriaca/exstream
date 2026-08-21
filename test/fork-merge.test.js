const _ = require('../src/index.js')
const h = require('./helpers.js')

test('merging basics', async () => {
  const results = await _([_([1, 2]), _([3, 4])])
    .merge({ concurrency: 1 })
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
    .merge({ concurrency: 2, ordered: true })
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
    .merge({ concurrency: 2, ordered: true })
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
    .merge({ concurrency: 2, ordered: true })
    .toArray()

  expect(results).toEqual([2, 4, 3, 6])
})

test('fork and merging - with toArray', async () => {
  const source = _([1, 2, 3, 4])
  const first = source.fork().map((i) => i * 2)
  const second = source.fork().map((i) => i * 3)
  const results = await _([first, second]).merge({ concurrency: 2, ordered: true }).toArray()
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
  const results = await _([first, second]).merge({ concurrency: 2, ordered: true }).toArray()
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

test('manual start allows reliable forks to be registered in different turns', async () => {
  const source = _([1, 2, 3], { start: 'manual' })
  const firstResult = source.fork().toArray()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const secondResult = source
    .fork()
    .map((x) => x * 2)
    .toArray()
  await source.start()

  const [first, second] = await Promise.all([firstResult, secondResult])
  expect(first).toEqual([1, 2, 3])
  expect(second).toEqual([2, 4, 6])
})

test('automatic activation accepts synchronous forks and closes before later turns', async () => {
  const source = _([1, 2, 3])
  const direct = source.fork().toArray()
  const synchronous = source
    .fork()
    .map((x) => x * 2)
    .toArray()

  await Promise.resolve()
  expect(() => source.fork()).toThrow("this stream is already started. you can't fork it anymore")
  await expect(Promise.all([direct, synchronous])).resolves.toEqual([
    [1, 2, 3],
    [2, 4, 6],
  ])
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
    .merge({ concurrency: 2, ordered: true })
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
    .merge({ concurrency: 3, ordered: false })
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

test('pipeTo writes to a Node destination', async () => {
  const res = []
  await _([1, 2, 3]).pipeTo(h.getSlowWritable(res, 0, 0))

  expect(res).toEqual([1, 2, 3])
})

test('writable streams cannot be wrapped in an exstream instance', async () => {
  let ex = null
  await _(h.getSlowWritable([], 0, 0))
    .toArray()
    .catch((e) => void (ex = e))
  expect(ex).not.toBe(null)
})