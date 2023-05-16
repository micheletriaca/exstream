const __ = require('../src/index.js')

test('throw in async mapping', () => {
  expect.assertions(2)
  try {
    __([1])
      .map(async () => {
        throw new Error('big booom in the async pipeline')
      })
      .resolve()
      .errors((error, push) => {
        expect(error.message).toEqual('big booom in the async pipeline')
        push(error)
      })
      .toArray(result => {
        expect(result).toEqual('')
      })
  } catch(error) {
    expect(error.message).toEqual('')
  }
})
