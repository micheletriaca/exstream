const _ = require('../src/index.js')

test('uniqBy keeps distinct composite keys without string coercion collisions', () => {
  const values = [
    { id: 1, first: 'a_', second: 'b' },
    { id: 2, first: 'a', second: '_b' },
    { id: 3, first: 1, second: undefined },
    { id: 4, first: '1', second: undefined },
    { id: 5, first: 'a_', second: 'b' },
  ]

  expect(_(values).uniqBy(['first', 'second']).values()).toEqual(values.slice(0, 4))
})

test.each([
  ['string', 'rejected as a string'],
  ['object', { code: 'REJECTED' }],
  ['object with a message', { message: 'object rejection' }],
  ['null', null],
  ['undefined', undefined],
  ['function', function rejectedFunction() {}],
])('resolve normalizes a Promise rejected with a %s', async (label, reason) => {
  const errors = []
  const rejected = Promise.reject(reason)

  const values = await _([rejected])
    .resolve()
    .errors((error) => errors.push(error))
    .toPromise()

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
    .resolve()
    .errors((error) => errors.push(error))
    .toPromise()

  expect(errors).toHaveLength(1)
  expect(errors[0]).toBeInstanceOf(Error)
  expect(errors[0].message).toBe('primitive failure')
  expect(errors[0].reason).toBe('primitive failure')
  expect(errors[0].exstreamInput).toBe(42)
})

test('resolve normalizes a cyclic rejection object without throwing while formatting it', async () => {
  const reason = {}
  reason.self = reason
  const errors = []

  await _([Promise.reject(reason)])
    .resolve()
    .errors((error) => errors.push(error))
    .toPromise()

  expect(errors).toHaveLength(1)
  expect(errors[0]).toBeInstanceOf(Error)
  expect(errors[0].message).toBe('[object Object]')
  expect(errors[0].reason).toBe(reason)
})

test.each([
  [
    'resolve parallelism',
    () => _([]).resolve(0),
    'error in .resolve(). parallelism must be a positive integer or Infinity',
  ],
  [
    'merge parallelism',
    () => _([]).merge(-1),
    'error in .merge(). parallelism must be a positive integer or Infinity',
  ],
  ['batch size', () => _([]).batch(1.5), 'error in .batch(). size must be a valid number'],
  [
    'rate count',
    () => _([]).ratelimit(0, 10),
    'error in .ratelimit(). num must be a positive integer',
  ],
  [
    'rate window',
    () => _([]).ratelimit(1, -1),
    'error in .ratelimit(). ms must be a non-negative finite number',
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
    'sorted join buffer',
    () => _([_([]), _([])]).sortedJoin('id', 'id', 'inner', 'asc', 0),
    'error in .sortedJoin(). buffer must be a positive integer',
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
  expect(_([1, 2, 3]).batch('2').values()).toEqual([[1, 2], [3]])
  expect(
    await _([Promise.resolve(1), Promise.resolve(2)])
      .resolve('2')
      .toPromise(),
  ).toEqual([1, 2])
})