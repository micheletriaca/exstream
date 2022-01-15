const { has } = require('../src/utils')

test('null', () => {
  expect(has({ property: null }, 'property')).toBe(true)
})

test('undefined', () => {
  expect(has({ property: undefined }, 'property')).toBe(true)
})

test('missing', () => {
  expect(has({}, 'property')).toBe(false)
})

test('success', () => {
  expect(has({ property: 'ok' }, 'property')).toBe(true)
  expect(has({ property: 1 }, 'property')).toBe(true)
})
