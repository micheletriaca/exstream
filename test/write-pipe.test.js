const { ObjectWritableMock } = require('stream-mock')

const __ = require('../src/index.js')

test('write to a stream from another stream', () => {
  const output = new ObjectWritableMock()
  const receiver = __().pipe(output)
  __([1, 2, 3])
    .tap(i => {
      receiver.write(i)
    })
    .values()
  expect(output.data).toEqual([1, 2, 3])
})

test('write to a stream from another stream 2', () => {
  const receiver = output => __()
    .tap(item => console.log(item))
    .map(i => i * 10)
    .pipe(output)
  const outputs = __([1, 2, 3])
    .map(i => {
      const output = new ObjectWritableMock()
      receiver(output).write(i * 10)
      return output
    })
    .values()
  expect(outputs[0].data).toEqual([100])
  expect(outputs[1].data).toEqual([200])
  expect(outputs[2].data).toEqual([300])
})
