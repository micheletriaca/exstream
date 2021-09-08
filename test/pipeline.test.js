const __ = require('../src/index.js')

const database = { existing: '1' }
const query1 = jest.fn().mockImplementation(async param => database[param])
const query2 = jest.fn().mockImplementation(async param => param + 1)
const exit = jest.fn()
const sourceInput = jest.fn()

const innerPipeline = __.pipeline()
  .map(query1)
  .resolve()
  // .tap(item => console.log(item))
  .filter(result => result === '1')

const mainFlow = param => {
  const source = __([param])
    .through(innerPipeline)

  const fork1 = source
    .fork()
    .map(query2)
    .resolve()

  const fork2 = source
    .fork()

  source.start()
  return __([fork1, fork2])
    .merge(2, true)
    .tap(exit)
}

beforeEach(() => {
  exit.mockReset()
  sourceInput.mockReset()
})

test('through before 2 forks should be executed', async () => {
  const results = await mainFlow('existing').toPromise()
  // console.log(results)
  expect(results).toHaveLength(2)
  expect(results).toEqual(['11', '1'])
  expect(exit).toHaveBeenCalledTimes(2)
  expect(exit).toHaveBeenLastCalledWith('1')
  // expect(exit).toHaveBeenNthCalledWith(2, '1', undefined)
})

test('zero results from main pipe -> nothing goes through forks', async () => {
  const results = await mainFlow('wrong').toPromise()
  expect(results).toEqual([])
  expect(sourceInput).toHaveBeenCalledTimes(0)
  expect(exit).toHaveBeenCalledTimes(0)
})
