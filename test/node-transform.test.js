const { Duplex, Readable, Writable } = require('node:stream')
const { pipeline: nodePipeline } = require('node:stream/promises')
const _ = require('../src/index.js')

const collectWith = async (transform, values) => {
  const output = []
  await nodePipeline(
    Readable.from(values),
    transform,
    new Writable({
      objectMode: true,
      write(value, encoding, done) {
        output.push(value)
        done()
      },
    }),
  )
  return output
}

test('a reusable pipeline becomes a native Node Transform', async () => {
  const definition = _.pipeline()
    .filter((value) => value % 2 === 1)
    .map((value) => ({ value, doubled: value * 2 }))
  const transform = definition.toNodeTransform()

  expect(transform).toBeInstanceOf(Duplex)
  expect(transform.readableObjectMode).toBe(true)
  expect(transform.writableObjectMode).toBe(true)
  await expect(collectWith(transform, [1, 2, 3])).resolves.toEqual([
    { value: 1, doubled: 2 },
    { value: 3, doubled: 6 },
  ])
})

test('toNodeTransform snapshots the definition and creates independent adapters', async () => {
  const definition = _.pipeline().map((value) => value * 2)
  const first = definition.toNodeTransform()
  definition.map((value) => value + 1)
  const second = definition.toNodeTransform()

  await expect(collectWith(first, [1, 2])).resolves.toEqual([2, 4])
  await expect(collectWith(second, [1, 2])).resolves.toEqual([3, 5])
})

test('an early Exstream completion drains the remaining Node input', async () => {
  const seen = []
  async function* source() {
    for (const value of [1, 2, 3]) {
      seen.push(value)
      yield value
    }
  }

  await expect(collectWith(_.pipeline().take(1).toNodeTransform(), source())).resolves.toEqual([1])
  expect(seen).toEqual([1, 2, 3])
})

test('an early completion still reports a later Node input failure', async () => {
  const reason = Error('input failed')
  async function* source() {
    yield 1
    throw reason
  }

  await expect(collectWith(_.pipeline().take(1).toNodeTransform(), source())).rejects.toBe(reason)
})

test('operator failures reject the enclosing Node pipeline with their provenance', async () => {
  const reason = Error('bad row')
  const transform = _.pipeline()
    .map(() => {
      throw reason
    })
    .toNodeTransform()

  await expect(collectWith(transform, [1])).rejects.toBe(reason)
  expect(_.errorInfo(reason)).toEqual({ origin: 'operator', stage: 'map', input: 1 })
})

test('a downstream Node failure cancels the transform input', async () => {
  let cleanedUp = false
  async function* source() {
    try {
      let value = 0
      while (true) yield ++value
    } finally {
      cleanedUp = true
    }
  }

  const reason = Error('destination failed')
  const completion = nodePipeline(
    Readable.from(source()),
    _.pipeline()
      .map((value) => value)
      .toNodeTransform(),
    new Writable({
      objectMode: true,
      write(value, encoding, done) {
        done(reason)
      },
    }),
  )

  await expect(completion).rejects.toBe(reason)
  await vi.waitFor(() => expect(cleanedUp).toBe(true))
})