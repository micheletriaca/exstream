const __ = require('../src/index.js')

const query = jest.fn().mockImplementation(async () => ({}))
const aggregate = (a, b) => ({ ...a, ...b })
const subtract = (a, b) => a - b

const innerPipeline = __.pipeline()
  .map(query)
  .resolve()

const mainFlow = param => {
  console.log('do something with', { param })
  const venueDebit = __([param])
    .through(innerPipeline)
    // .tap(item => console.log(item)) // uncomment this make everything work :)

  const totalPaid = venueDebit
    .fork()
    .map(query)
    .resolve()
    // .flatten() // this make it all fails, it should not.

  const totalDebt = venueDebit
    .fork()

  venueDebit.start()
  return __([totalDebt, totalPaid])
    .merge()
    .reduce1(aggregate)
    .tap(item => console.log(item))
    .map(({ totalDebt, totalPaid }) => subtract(totalDebt, totalPaid))
}

test('through', async () => {
  const [result] = await mainFlow('something').toPromise()
  expect(result).toEqual(NaN)
})
