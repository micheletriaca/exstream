const _ = require('../src/index.js')
const { curry } = _

const aModule = ({ debug }, id) => {
  return _([id])
    .map(id => ({ id }))
}

const curried = curry(aModule)

const instance = curried({ debug: console.log })

test('do it', done => {
  const value = _([1])
    .through(instance)
    .value()
  expect(value).toEqual({ id: 1 })
  done()
})
