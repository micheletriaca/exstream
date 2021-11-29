const { isDefined } = require('../src/utils')

const nullProperty = { property: null }
const undefinedProperty = { property: undefined }
const missingProperty = { }

test('null', () => {
  expect(isDefined(nullProperty, 'property')).toEqual(false)
})

test('undefined', () => {
  expect(isDefined(undefinedProperty, 'property')).toEqual(false)
})

test('missing', () => {
  expect(isDefined(missingProperty, 'property')).toEqual(false)
})
