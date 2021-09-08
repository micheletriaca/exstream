const __ = require('../src/index.js')

const query = jest.fn().mockImplementation(async () => ({}))
const aggregate = (a, b) => ({ ...a, ...b })

const innerPipeline = __.pipeline()
  .map(query)
  .resolve()

const mainFlow = param => {
  console.log('do something with', { param })
  const source = __([param])
    .through(innerPipeline)
    // .tap(item => console.log(item)) // uncomment this make everything work :)

  const fork1 = source
    .fork()
    .map(query)
    .resolve()
    // .flatten() // this make it all fails, it should not.

  const fork2 = source
    .fork()

  source.start()
  return __([fork1, fork2])
    .merge()
    .reduce1(aggregate)
    .tap(item => console.log(item))
}

test('through', async () => {
  const [result] = await mainFlow('something').toPromise()
  expect(result).toEqual({})
})
