const _ = require('../src/index.js')

test('uniq keeps distinct composite keys without string coercion collisions', async () => {
  const values = [
    { id: 1, first: 'a_', second: 'b' },
    { id: 2, first: 'a', second: '_b' },
    { id: 3, first: 1, second: undefined },
    { id: 4, first: '1', second: undefined },
    { id: 5, first: 'a_', second: 'b' },
  ]

  expect(await _(values).uniq(['first', 'second']).toArray()).toEqual(values.slice(0, 4))
})

test.each([
  ['string', 'rejected as a string'],
  ['object', { code: 'REJECTED' }],
  ['object with a message', { message: 'object rejection' }],
  ['null', null],
  ['undefined', undefined],
  ['function', function rejectedFunction() {}],
])('mapAsync normalizes a Promise rejected with a %s', async (label, reason) => {
  const errors = []
  const rejected = Promise.reject(reason)

  const values = await _([rejected])
    .mapAsync((value) => value)
    .errors((error) => errors.push(error))
    .toArray()

  expect(values).toEqual([])
  expect(errors).toHaveLength(1)
  expect(errors[0]).toBeInstanceOf(Error)
  expect(errors[0].reason).toBe(reason)
  expect(errors[0].exstreamInput).toBe(rejected)
})

test('map preserves the source input when an async callback rejects with a primitive', async () => {
  const errors = []

  await _([42])
    .map(async () => Promise.reject('primitive failure'))
    .mapAsync((value) => value)
    .errors((error) => errors.push(error))
    .toArray()

  expect(errors).toHaveLength(1)
  expect(errors[0]).toBeInstanceOf(Error)
  expect(errors[0].message).toBe('primitive failure')
  expect(errors[0].reason).toBe('primitive failure')
  expect(errors[0].exstreamInput).toBe(42)
})

test('mapAsync normalizes a cyclic rejection object without throwing while formatting it', async () => {
  const reason = {}
  reason.self = reason
  const errors = []

  await _([Promise.reject(reason)])
    .mapAsync((value) => value)
    .errors((error) => errors.push(error))
    .toArray()

  expect(errors).toHaveLength(1)
  expect(errors[0]).toBeInstanceOf(Error)
  expect(errors[0].message).toBe('[object Object]')
  expect(errors[0].reason).toBe(reason)
})

test.each([
  [
    'map options',
    () => _([]).map(String, { wrap: true }),
    'error in .map(). options are no longer supported',
  ],
  [
    'merge concurrency',
    () => _([]).merge({ concurrency: -1 }),
    'error in .merge(). concurrency must be a positive integer or Infinity',
  ],
  ['merge options', () => _([]).merge(1), 'error in .merge(). options must be an object'],
  [
    'merge order',
    () => _([]).merge({ ordered: 1 }),
    'error in .merge(). ordered must be a boolean',
  ],
  ['batch size', () => _([]).batch(1.5), 'error in .batch(). size must be a valid number'],
  ['rate options', () => _([]).rateLimit(1), 'error in .rateLimit(). options must be an object'],
  [
    'rate count',
    () => _([]).rateLimit({ limit: 0, interval: 10 }),
    'error in .rateLimit(). limit must be a positive integer',
  ],
  [
    'rate window',
    () => _([]).rateLimit({ limit: 1, interval: -1 }),
    'error in .rateLimit(). interval must be a non-negative finite number',
  ],
  [
    'throttle window',
    () => _([]).throttle(Infinity),
    'error in .throttle(). ms must be a non-negative finite number',
  ],
  [
    'scheduler timeout',
    () => _([]).makeAsync(-1),
    'error in .makeAsync(). maxSyncExecutionTime must be a non-negative finite number',
  ],
  [
    'sorted join order',
    () => _([]).sortedJoin(_([]), { leftKey: 'id', order: 'sideways', rightKey: 'id' }),
    "error in .sortedJoin(). order must be 'asc', 'desc', or a comparator",
  ],
  [
    'non-coercible batch size',
    () => _([]).batch(Symbol('size')),
    'error in .batch(). size must be a valid number',
  ],
  [
    'non-coercible throttle window',
    () => _([]).throttle(Symbol('window')),
    'error in .throttle(). ms must be a non-negative finite number',
  ],
])('%s rejects values that cannot make progress safely', (label, createPipeline, message) => {
  expect(createPipeline).toThrow(message)
})

test('numeric strings remain accepted for historically coerced limits', async () => {
  expect(await _([1, 2, 3]).batch('2').toArray()).toEqual([[1, 2], [3]])
  expect(
    await _([Promise.resolve(1), Promise.resolve(2)])
      .mapAsync((value) => value, { concurrency: '2' })
      .toArray(),
  ).toEqual([1, 2])
})