const _ = require('../src/index.js')

test('pipeline internals are not exposed as mutable properties', async () => {
  const pipeline = _.pipeline()

  expect(pipeline.definitions).toBeUndefined()
  expect(pipeline.generateStream).toBeUndefined()
  expect(pipeline.unknownProperty).toBeUndefined()
  expect(Object.getOwnPropertySymbols(pipeline)).toEqual([])

  const map = pipeline.map
  expect(map((value) => value)).toBe(pipeline)
  await expect(_([1]).through(pipeline).toArray()).resolves.toEqual([1])
})

test('stream graph and scheduler internals are private', () => {
  const stream = _([1]).map((value) => value)

  expect(stream.paused).toBe(true)
  for (const property of ['source', 'endOfChain', 'pausedFromInside', 'pausedFromOutside']) {
    expect(property in stream).toBe(false)
  }
})

test('pipeline definitions reject instance-only methods before recording them', () => {
  const pipeline = _.pipeline()

  expect(() => pipeline.toNodeReadable()).toThrow(
    'toNodeReadable() is not available on reusable pipelines. Use toNodeTransform() instead.',
  )
  expect(() => pipeline.toArray()).toThrow(
    'toArray() is not available on reusable pipelines. Attach the pipeline to an Exstream',
  )
  expect(() => pipeline.routeErrors()).toThrow(
    'routeErrors() is not available on reusable pipelines',
  )
  expect(() => pipeline.sortedJoin()).toThrow('sortedJoin() is not available on reusable pipelines')
  expect(pipeline.definitions).toBeUndefined()
})

test('pipeline through composes functional operators without a global registry', async () => {
  const double = (stream) => stream.map((value) => value * 2)
  const reusable = _.pipeline().through(double)

  await expect(_([1, 2]).through(reusable).toArray()).resolves.toEqual([2, 4])

  const nested = _.pipeline().map((value) => value + 1)
  const composed = _.pipeline().through(nested).through(double)
  await expect(_([1, 2]).through(composed).toArray()).resolves.toEqual([4, 6])
})