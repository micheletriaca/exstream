const __ = require('../src/index.js')

test('merge input and output and keep ordering', async () => {
  const source = [1, 2, 3]
  const input = __(source)
  const output = __(source)
    .map(i => i * 10)

  const merged = await __([input, output])
    .merge()
    .tap(console.log)
    .batch(2)
    .toPromise()
  expect(merged).toEqual([[1, 10], [2, 20], [3, 30]])
})
