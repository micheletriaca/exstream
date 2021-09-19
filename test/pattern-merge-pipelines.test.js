const _ = require('../src/index.js')
const __ = require('highland')

const input = [1, 2, 3]

test('merge static pipelines', async () => {
  const source = _(input)
  const pipelines = [_.pipeline(), _.pipeline()]

  const forks = pipelines
    .map(pipeline => source.fork().through(pipeline))

  source.start()
  const results = await _(forks)
    .merge()
    .toPromise()
  expect(results).toEqual([1, 1, 2, 2, 3, 3])
})

test('merge dynamic pipelines', async () => {
  const singleInput = [1]
  const source1 = _(singleInput)
  const fork1 = source1.fork().map(() => _.pipeline().map(x => x + 1))
  const fork2 = source1.fork().map(() => _.pipeline().map(x => x + 2))
  source1.start()
  const pipelines = _([fork1, fork2]).merge().values()

  expect(pipelines).toHaveLength(2)

  const source2 = _(singleInput)
  const forks = pipelines
    .map(pipeline => source2.fork().through(pipeline))

  source2.start()
  const results = await _(forks)
    .merge()
    .toPromise()
  expect(results).toEqual([2, 3])
})

test('merge pipelines - highland', async () => {
  const source = __(input)
  const pipelines = [__.pipeline(), __.pipeline()]

  const forks = pipelines
    .map(pipeline => source.fork().through(pipeline))

  const results = await __(forks)
    .merge()
    .collect()
    .toPromise(Promise)
  expect(results).toEqual([1, 1, 2, 2, 3, 3])
})
