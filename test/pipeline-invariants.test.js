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