const { isDefined } = require('../src/utils')

test('null', () => {
  expect(isDefined({ property: null }, 'property')).toBe(false)
})

test('undefined', () => {
  expect(isDefined({ property: undefined }, 'property')).toBe(false)
})

test('missing', () => {
  expect(isDefined({}, 'property')).toBe(false)
})

test('success', () => {
  expect(isDefined({ property: 'ok' }, 'property')).toBe(true)
  expect(isDefined({ property: 1 }, 'property')).toBe(true)
})
