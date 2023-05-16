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

test('throw in sync mapping', () => {
  expect.assertions(2)
  try {
    __([1])
      .map(() => {
        throw new Error('big booom in the async pipeline')
      })
      .errors((error, push) => {
        expect(error.message).toEqual('big booom in the async pipeline')
        push(error)
      })
      .toArray(result => {
        expect(result).toEqual('')
      })
  } catch(error) {
    expect(error.code).toEqual('ERR_UNHANDLED_ERROR')
    // expect(error.context).toEqual(['Error: big booom in the async pipeline'])
    // expect(error).toEqual({})
  }
})
