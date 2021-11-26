const xs = require('../src/index.js')
const __ = require('highland')

const input = [1, 2, 3]

test('merge static pipelines', async () => {
  const source = xs(input)
  const pipelines = [xs.pipeline(), xs.pipeline()]

  const forks = pipelines
    .map(pipeline => source.fork().through(pipeline))

  const results = await xs(forks)
    .merge()
    .toPromise()
  expect(results).toEqual([1, 1, 2, 2, 3, 3])
})

test('merge dynamic pipelines', async () => {
  const singleInput = [1]
  const source = xs(singleInput)
  const fork1 = source.fork().map(() => xs.pipeline().map(x => x + 1))
  const fork2 = source.fork().map(() => xs.pipeline().map(x => x + 2))
  // source.start()
  const pipelines = await xs([fork1, fork2]).merge().toPromise()
  // const pipelines = await xs([fork1, fork2]).merge().values() // in 0.19

  expect(pipelines).toHaveLength(2)

  const forks = pipelines
    .map(pipeline => xs(singleInput).fork().through(pipeline))

  const results = await xs(forks)
    .merge()
    .toPromise()
  expect(results).toEqual([2, 3])
})

test('merge static pipelines - highland', async () => {
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
