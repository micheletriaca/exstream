const _ = require('../src/index.js')

test('partial', () => {
  const add = (...args) => args.reduce((memo, x) => x + memo, 0)
  const add5 = _.partial(add, 3, 2)
  expect(add5(5)).toBe(10)
})

test('nCurry', () => {
  const add = (...args) => args.reduce((memo, x) => x + memo, 0)
  const add2ToOther3Numbers = _.ncurry(4, add, 2)
  expect(add2ToOther3Numbers(1, 2, 3)).toBe(8)
  expect(add2ToOther3Numbers(1)(2, 3)).toBe(8)
  expect(add2ToOther3Numbers(1, 2)(3)).toBe(8)
  expect(add2ToOther3Numbers(1)(2)(3)).toBe(8)
  expect(add2ToOther3Numbers(1, 2, 3, 4)).toBe(8)
})

test('curry', () => {
  const add = (a, b, c, d) => a + b + c + d
  const curriedFn = _.curry(add, 2)
  expect(curriedFn(1, 2, 3)).toBe(8)
  expect(curriedFn(1)(2, 3)).toBe(8)
  expect(curriedFn(1, 2)(3)).toBe(8)
  expect(curriedFn(1)(2)(3)).toBe(8)
})
