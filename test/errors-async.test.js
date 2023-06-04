const __ = require('../src/index.js')

test('throw in async mapping', async () => {
  // to catch not handled errors in an async pipeline, you need to listen to the error event or to convert
  // the flow to a promise and to catch errors on the promise
  expect.assertions(2)
  try {
    await __([1])
      .map(async () => {
        throw new Error('big booom in the async pipeline')
      })
      .resolve()
      .errors((error, push) => {
        expect(error.message).toEqual('big booom in the async pipeline')
        push(error)
      })
      .toPromise()    
  } catch(error) {
    expect(error.message).toEqual('big booom in the async pipeline')
  }
})

test('throw in sync mapping', () => {
  // if the flow is sync, the errors are immediately thrown 
  expect.assertions(2)
  try {
    const res = __([1])
      .map(() => {
        throw new Error('big booom in the sync pipeline')
      })
      .errors((error, push) => {
        expect(error.message).toEqual('big booom in the sync pipeline')
        push(error)
      })
      .values()
  } catch(error) {
    expect(error.message).toEqual('big booom in the sync pipeline')
  }
})
