const { Readable } = require('stream')
const _ = require('../src/index.js')

test('toArray always returns a promise for a synchronous pipeline', async () => {
  const result = _([1, 2, 3])
    .map((value) => value * 2)
    .filter((value) => value > 2)
    .toArray()

  expect(result).toBeInstanceOf(Promise)
  await expect(result).resolves.toEqual([4, 6])
})

test('toArray retains synchronous record context semantics', async () => {
  const result = await _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .map((value, context) => ({ correlationId: context.correlationId, value }))
    .toArray()

  expect(result).toEqual([
    { correlationId: 'row-1', value: 1 },
    { correlationId: 'row-2', value: 2 },
  ])
})

test('toArray rejects synchronous transformation errors', async () => {
  await expect(
    _([1, 2])
      .map((value) => {
        if (value === 2) throw Error('invalid value')
        return value
      })
      .toArray(),
  ).rejects.toMatchObject({ exstreamInput: 2, message: 'invalid value' })
})

test.each([
  ['mapAsync', () => _([Promise.resolve(1)]).mapAsync((value) => value)],
  ['mapAsync', () => _([1]).mapAsync(async (value) => value)],
  ['generator', () => _((write) => write(_.nil))],
  ['Node readable', () => _(Readable.from([1]))],
])('toArray consumes an asynchronous %s pipeline', async (name, createStream) => {
  await expect(createStream().toArray()).resolves.toBeInstanceOf(Array)
})

test('toArray has the same Promise contract for asynchronous pipelines', async () => {
  const result = _([1, 2])
    .mapAsync(async (value) => value * 2)
    .toArray()

  expect(result).toBeInstanceOf(Promise)
  await expect(result).resolves.toEqual([2, 4])
})

test('single resolves one value and resolves undefined for an empty stream', async () => {
  await expect(_([42]).single()).resolves.toBe(42)
  await expect(_([]).single()).resolves.toBeUndefined()
})

test('single rejects when the stream emits more than one value', async () => {
  await expect(_([1, 2]).single()).rejects.toMatchObject({
    code: 'EXSTREAM_MORE_THAN_ONE_VALUE',
  })
})

test('drain consumes the stream without collecting values', async () => {
  const seen = []
  const result = _([1, 2, 3])
    .tap((value) => seen.push(value))
    .drain()

  expect(result).toBeInstanceOf(Promise)
  await expect(result).resolves.toBeUndefined()
  expect(seen).toEqual([1, 2, 3])
})

test('streams are directly async iterable', async () => {
  const values = []

  for await (const value of _([1, 2, 3])) values.push(value)

  expect(values).toEqual([1, 2, 3])
})

test('removed methods are not exposed', () => {
  const stream = _([])

  for (const name of [
    'each',
    'massCatch',
    'massThen',
    'pull',
    'pipe',
    'resolve',
    'toAsyncIterator',
    'toNodeStream',
    'toPromise',
    'value',
    'values',
    'valuesSync',
  ]) {
    expect(stream[name]).toBeUndefined()
  }

  for (const name of [
    'drain',
    'massCatch',
    'massThen',
    'pipeTo',
    'resolve',
    'toArray',
    'toAsyncIterator',
    'toNodeReadable',
    'toNodeStream',
    'toPromise',
    'toWebReadable',
  ]) {
    expect(_[name]).toBeUndefined()
  }
})