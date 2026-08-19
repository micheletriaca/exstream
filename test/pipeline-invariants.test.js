const _ = require('../src/index.js')

test('pipeline property reads do not register stream operators', () => {
  const pipeline = _.pipeline()

  expect(pipeline.definitions).toEqual([])
  expect(pipeline.unknownProperty).toBeUndefined()
  expect(pipeline.definitions).toEqual([])

  const map = pipeline.map
  expect(map((value) => value)).toBe(pipeline)
  expect(pipeline.definitions).toHaveLength(1)
  expect(pipeline.definitions[0].method).toBe('map')
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
  expect(pipeline.definitions).toEqual([])
})

test('extend controls whether a custom method is reusable in pipelines', async () => {
  _.extend('doubleForPipeline', function () {
    return this.map((value) => value * 2)
  })
  const reusable = _.pipeline().doubleForPipeline()
  await expect(_([1, 2]).through(reusable).toArray()).resolves.toEqual([2, 4])

  _.extend(
    'instanceOnlyExtension',
    function () {
      return this.toArray()
    },
    { pipeline: false },
  )
  expect(() => _.pipeline().instanceOnlyExtension()).toThrow(
    'instanceOnlyExtension() is not available on reusable pipelines',
  )
})