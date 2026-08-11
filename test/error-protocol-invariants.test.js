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

test('pushing an Error as data still routes it through the error channel', async () => {
  const reason = Error('ambiguous value')
  const errors = []

  const values = await _([1])
    .consumeSync((error, value, push) => {
      if (error || value === _.nil) push(error, value)
      else push(null, reason)
    })
    .errors((error) => errors.push(error))
    .toPromise()

  expect(values).toEqual([])
  expect(errors).toEqual([reason])
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