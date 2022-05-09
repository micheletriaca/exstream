const { promisify } = require('util')
const { finished: finishedCallback } = require('stream')
const { ObjectWritableMock } = require('stream-mock')

const __ = require('../src/index.js')

const finished = promisify(finishedCallback)

test('pipe first flow into second flow', async () => {
  const input = [1, 2, 3]
  const output = new ObjectWritableMock()
  const double = i => i * 10
  const flow1 = __(input)
  const flow2 = __().map(double).pipe(output)
  __(flow1)
    .pipe(flow2)
  await finished(flow2)
  expect(output.data).toHaveLength(3)
  expect(output.data).toEqual([2, 4, 6]) // map(double) in flow2 is ignored!
})
