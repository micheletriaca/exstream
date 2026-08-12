const _ = require('../src/index.js')

test('an Error supplied as a source value is routed through the error channel', async () => {
  const reason = Error('record failure')
  const errors = []

  const values = await _([1, reason, 2])
    .errors((error) => errors.push(error))
    .toPromise()

  expect(values).toEqual([1, 2])
  expect(errors).toEqual([reason])
})

test('an error-like object remains an ordinary data value', () => {
  const value = { message: 'looks like an error', code: 'NOT_AN_ERROR' }

  expect(_([value]).values()).toEqual([value])
})

test('pushing an Error through the data argument does not reclassify it', async () => {
  const reason = Error('ambiguous value')
  const errors = []

  const values = await _([1])
    .consumeSync((error, value, push) => {
      if (error || value === _.nil) push(error, value)
      else push(null, reason)
    })
    .errors((error) => errors.push(error))
    .toPromise()

  expect(values).toEqual([reason])
  expect(errors).toEqual([])
})

test('an Error can be marked as data in an iterable source', () => {
  const reason = Error('business value')

  expect(
    _([_.data(reason)])
      .map((value) => value)
      .values(),
  ).toEqual([reason])
})

test('writeData writes an Error without routing it through the error channel', async () => {
  const reason = Error('manual value')
  const source = _()
  const errors = []
  const result = source.errors((error) => errors.push(error)).toPromise()

  source.writeData(reason)
  source.end()

  await expect(result).resolves.toEqual([reason])
  expect(errors).toEqual([])
})

test('writeData rejects values after stream termination', () => {
  const source = _()
  source.end()

  expect(() => source.writeData('late value')).toThrow('Cannot write to stream after nil')
})

test('an Error data value remains data across reliable forks', async () => {
  const reason = Error('forked value')
  const source = _([_.data(reason)])
  const first = source.fork().toPromise()
  const second = source.fork().toPromise()

  await expect(Promise.all([first, second])).resolves.toEqual([[reason], [reason]])
})

test('merge does not reclassify an Error data value', async () => {
  const reason = Error('merged value')
  const errors = []

  const values = await _([_([_.data(reason)])])
    .merge()
    .errors((error) => errors.push(error))
    .toPromise()

  expect(values).toEqual([reason])
  expect(errors).toEqual([])
})

test('an error record is delivered to every fork without ending data flow', async () => {
  const reason = Error('shared failure')
  const source = _([1, reason, 2])
  const firstErrors = []
  const secondErrors = []
  const first = source
    .fork()
    .errors((error) => firstErrors.push(error))
    .toPromise()
  const second = source
    .fork()
    .errors((error) => secondErrors.push(error))
    .toPromise()

  const [firstValues, secondValues] = await Promise.all([first, second])

  expect(firstValues).toEqual([1, 2])
  expect(secondValues).toEqual([1, 2])
  expect(firstErrors).toEqual([reason])
  expect(secondErrors).toEqual([reason])
  expect(source.state).toBe('ended')
})

test('a buffered error record retains its channel until consumption starts', async () => {
  const reason = Error('buffered failure')
  const errors = []
  const source = _()
  source.write(reason)
  const result = source.errors((error) => errors.push(error)).toPromise()

  source.end()

  await expect(result).resolves.toEqual([])
  expect(errors).toEqual([reason])
})

test('an error record overflowing an observer aborts only that observer', async () => {
  const reason = Error('observed record failure')
  const source = _()
  const observer = source.observe({ bufferLimit: 0 })
  const errors = []
  const result = source.errors((error) => errors.push(error)).toPromise()

  source.write(reason)
  source.end()

  await expect(result).resolves.toEqual([])
  expect(errors).toEqual([reason])
  expect(observer.state).toBe('aborted')
  expect(observer.abortReason).toBeInstanceOf(_.BufferOverflowError)
})

test('merge rejects values that are not streams', async () => {
  await expect(_([1]).merge().toPromise()).rejects.toThrow(
    '.merge() can merge ONLY exstream instances',
  )
})