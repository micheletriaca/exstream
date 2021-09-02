const _ = require('../src/index.js')
const { curry } = _

const aModule = ({ debug }, id) => {
  const stream = _([id])
    .map(id => ({ id }))

  return curry(stream)
}

test('do it', () => {
  const instance = aModule({ debug: console.log })
  const value = _([1])
    .through(instance)
    .value()
  expect(value).toEqual({ id: 1 })
})
