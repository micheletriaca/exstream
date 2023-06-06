const _ = require('../src/index.js')
const { pipeline } = _

const successErrorsFlow = require('./success-errors-flow')

test('pipeline with simple map is called', async () => {
  const sourceFlow = _([1, 2]).map(x => {
    if (x > 1) throw new Error(`${x} is wrong`)
    return x * 10
  })
  const eachError = jest.fn()
  const print = jest.fn()
  const field = 'message'
  const title = 'Errors:'
  const errorsPipeline = pipeline()
    .map(x => ({ ...x, just: 'mapped' }))
    .tap(print)

  const wrap = successErrorsFlow({
    eachError,
    errorsPipeline,
  })
  const stream = wrap(sourceFlow)
  const results = await stream.toPromise()
  expect(results).toEqual([10])
  expect(eachError).toHaveBeenCalledTimes(1)
  expect(print).toHaveBeenCalledTimes(1)
  // expect(eachError).toHaveBeenCalledWith('')
  // expect(print).toHaveBeenCalledWith('')
})

test('pipeline is not called', async () => {
  const sourceFlow = _([1, 2]).map(x => {
    if (x > 1) throw new Error(`${x} is too high`)
    return x * 10
  })
  const eachError = jest.fn()
  const print = jest.fn()
  const field = 'message'
  const title = 'Errors:'
  const errorsPipeline = pipeline()
    .reduce((aggregate, item) => {
      const { total, messages } = aggregate
      const { [field]: message } = item
      console.log(title, { message })
      return {
        total: total + 1,
        messages: [...messages, message],
      }
    }, { messages: [], total: 0 })
    .tap(console.log)
    .tap(print)

  const wrap = successErrorsFlow({
    eachError,
    errorsPipeline,
  })
  const stream = wrap(sourceFlow)
  const results = await stream.toPromise()
  expect(results).toEqual([10])
  expect(eachError).toHaveBeenCalledTimes(1)
  expect(print).toHaveBeenCalledTimes(1)
  // expect(eachError).toHaveBeenCalledWith('')
  // expect(print).toHaveBeenCalledWith('')
})
