const xs = require('../src/index.js')
const __ = require('highland')

const input = [1, 2, 3]

test('merge static pipelines', async () => {
  const source = xs(input)
  const pipelines = [xs.pipeline(), xs.pipeline()]

  const forks = pipelines
    .map(pipeline => source.fork().through(pipeline))

  source.start()
  const results = await xs(forks)
    .merge()
    .toPromise()
  expect(results).toEqual([1, 1, 2, 2, 3, 3])
})

test('merge dynamic pipelines', async () => {
  const singleInput = [1]
  const source1 = xs(singleInput)
  const fork1 = source1.fork().map(() => xs.pipeline().map(x => x + 1))
  const fork2 = source1.fork().map(() => xs.pipeline().map(x => x + 2))
  source1.start()
  const pipelines = xs([fork1, fork2]).merge().values()

  expect(pipelines).toHaveLength(2)

  const source2 = xs(singleInput)
  const forks = pipelines
    .map(pipeline => source2.fork().through(pipeline))

  source2.start()
  const results = await xs(forks)
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
