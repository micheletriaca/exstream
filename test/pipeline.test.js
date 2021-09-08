const __ = require('../src/index.js')

const database = { existing: '1' }
const query = jest.fn().mockImplementation(async param => database[param])
const exit = jest.fn()
const sourceInput = jest.fn()

const innerPipeline = __.pipeline()
  .map(query)
  .resolve()
  .filter(result => result === '1')

const mainFlow = param => {
  console.log('do something with', { param })
  const source = __([param])
    .through(innerPipeline)
    // BUG: no tap, no party...
    .tap(sourceInput)
    // .tap(item => console.log(item))

  const fork1 = source
    .fork()
    .map(query)
    .resolve()
    // .tap(item => console.log(item))

  const fork2 = source
    .fork()
    // .map(() => 2) // uncomment this to see surprises

  source.start()
  return __([fork1, fork2])
    .merge(2, false)
    // .tap(item => console.log(item))
    .tap(exit)
}

beforeEach(() => {
  exit.mockReset()
  sourceInput.mockReset()
})

test('through is not executed without a tap', async () => {
  const results = await mainFlow('existing').toPromise()
  console.log(results)
  expect(results).toHaveLength(2)
  expect(results).toEqual(['1', undefined])
  expect(exit).toHaveBeenCalledTimes(2)
  expect(exit).toHaveBeenLastCalledWith(undefined)
  // expect(exit).toHaveBeenNthCalledWith(2, '1', undefined)
})

test('wrong param 1', async () => {
  const results = await mainFlow('wrong').toPromise()
  expect(results).toEqual([])
  expect(sourceInput).toHaveBeenCalledTimes(0)
  expect(exit).toHaveBeenCalledTimes(0)
})
