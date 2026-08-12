const { Readable } = require('stream')
const _ = require('../src/index.js')

test('valuesSync returns the values of a synchronous pipeline', () => {
  expect(
    _([1, 2, 3])
      .map((value) => value * 2)
      .filter((value) => value > 2)
      .valuesSync(),
  ).toEqual([4, 6])
})

test('valuesSync retains synchronous record context semantics', () => {
  const result = _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .map((value, context) => ({ correlationId: context.correlationId, value }))
    .valuesSync()

  expect(result).toEqual([
    { correlationId: 'row-1', value: 1 },
    { correlationId: 'row-2', value: 2 },
  ])
})

test('valuesSync preserves synchronous transformation errors', () => {
  expect(() =>
    _([1, 2])
      .map((value) => {
        if (value === 2) throw Error('invalid value')
        return value
      })
      .valuesSync(),
  ).toThrow(expect.objectContaining({ exstreamInput: 2, message: 'invalid value' }))
})

test.each([
  ['resolve', () => _([Promise.resolve(1)]).resolve()],
  ['mapAsync', () => _([1]).mapAsync(async (value) => value)],
  ['generator', () => _((write) => write(_.nil))],
  ['Node readable', () => _(Readable.from([1]))],
])('valuesSync rejects an asynchronous %s pipeline immediately', (name, createStream) => {
  expect(() => createStream().valuesSync()).toThrow(
    'this stream is asynchronous. use .toPromise() instead of .valuesSync()',
  )
})

test('values keeps its historical Promise behavior for asynchronous pipelines', async () => {
  const result = _([1, 2])
    .mapAsync(async (value) => value * 2)
    .values()

  expect(result).toBeInstanceOf(Promise)
  await expect(result).resolves.toEqual([2, 4])
})