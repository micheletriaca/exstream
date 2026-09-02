const { Transform, Writable } = require('node:stream')
const JSONStream = require('JSONStream')
const _ = require('../src/index.js')
const { nextTurn } = require('./invariant-helpers.js')

test('through waits for downstream demand before starting a Node transform', async () => {
  const iterator = vi.fn(() => [{ id: 1 }, { id: 2 }][Symbol.iterator]())
  const source = { [Symbol.iterator]: iterator }
  const transform = new Transform({
    objectMode: true,
    transform(value, encoding, done) {
      done(null, value)
    },
  })
  const output = _(source).through(transform)

  await nextTurn()
  expect(iterator).not.toHaveBeenCalled()

  await expect(output.toArray()).resolves.toEqual([{ id: 1 }, { id: 2 }])
  expect(iterator).toHaveBeenCalledOnce()
})

test('through preserves output and completion from legacy flowing Node transforms', async () => {
  const chunks = []
  const destination = new Writable({
    write(chunk, encoding, done) {
      chunks.push(chunk.toString())
      done()
    },
  })

  await expect(
    _([{ id: 1 }, { id: 2 }])
      .through(JSONStream.stringify('[\n', '\n,\n', '\n]'))
      .pipeTo(destination),
  ).resolves.toBeUndefined()

  expect(chunks.join('')).toBe('[\n{"id":1}\n,\n{"id":2}\n]')
  expect(destination.writableFinished).toBe(true)
})