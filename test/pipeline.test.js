const _ = require('../src/index.js')
const h = require('./helpers')

const database = { existing: '1' }
const query1 = vi.fn().mockImplementation(async (param) => database[param])
const query2 = vi.fn().mockImplementation(async (param) => param + 1)
const exit = vi.fn()
const sourceInput = vi.fn()

const innerPipeline = _.pipeline()
  .map(query1)
  .mapAsync((value) => value)
  // .tap(item => console.log(item))
  .filter((result) => result === '1')

const mainFlow = (param) => {
  const source = _([param]).through(innerPipeline)

  const fork1 = source
    .fork()
    .map(query2)
    .mapAsync((value) => value)

  const fork2 = source.fork()

  return _([fork1, fork2]).merge(2, true).tap(exit)
}

beforeEach(() => {
  exit.mockReset()
  sourceInput.mockReset()
})

test('through before 2 forks should be executed', async () => {
  const results = await mainFlow('existing').toArray()
  // console.log(results)
  expect(results).toHaveLength(2)
  expect(results).toEqual(['11', '1'])
  expect(exit).toHaveBeenCalledTimes(2)
  expect(exit).toHaveBeenLastCalledWith('1')
  // expect(exit).toHaveBeenNthCalledWith(2, '1', undefined)
})

test('zero results from main pipe -> nothing goes through forks', async () => {
  const results = await mainFlow('wrong').toArray()
  expect(results).toEqual([])
  expect(sourceInput).toHaveBeenCalledTimes(0)
  expect(exit).toHaveBeenCalledTimes(0)
})

test('pipeline with fork', async () => {
  const p = _.pipeline()
    .map(async (x) => x)
    .mapAsync((value) => value)

  const s = _([1, 2, 3]).through(p)
  const forks = [
    s.fork().map((x) => x * 2),
    s
      .fork()
      .map(async (x) => x * 3)
      .mapAsync((value) => value),
  ]
  const res = await _(forks).merge().toArray()
  expect(res).toEqual([2, 3, 4, 6, 6, 9])
})

test('pipeline with pipe and multiple through', async () => {
  const p = _.pipeline()
    .map(async (x) => x * 2)
    .mapAsync((value) => value)
  const res = []

  await _([1, 2, 3])
    .through(p)
    .through(p)
    .pipeTo(h.getSlowWritable(res, 0, 0))

  expect(res).toEqual([4, 8, 12])
})

test('pipeline in through', async () => {
  const p = _.pipeline()
    .map(async (x) => x * 2)
    .mapAsync((value) => value)
  const res = []

  await _([1, 2, 3])
    .through(p)
    .through(p)
    .pipeTo(h.getSlowWritable(res, 0, 0))

  expect(res).toEqual([4, 8, 12])
})

test('pipeline as node stream toArray', async () => {
  const p = _.pipeline()
    .map(async (x) => x * 2)
    .mapAsync((value) => value)

  const res = await _([1, 2, 3]).through(p.generateStream()).toArray()

  expect(res).toEqual([2, 4, 6])
})

test('error propagation in async chain', async () => {
  const errs = []
  const res = await _([{ a: 0 }, { a: 1 }, { a: 2 }])
    .collect()
    .flatten()
    .map((x) => ({ a: x.a === 1 ? x.b.c : x.a }))
    .map(async (x) => x)
    .mapAsync((value) => value)
    .errors((e) => errs.push(e))
    .toArray()
  expect(res).toEqual([{ a: 0 }, { a: 2 }])
  expect(errs.length).toBe(1)
})

test('nested pipeline as last operation', async () => {
  const innerPipeline = _.pipeline().map((x) => x + 1)
  const mainPipeline = _.pipeline()
    .map((x) => x + 1)
    .through(innerPipeline)
  // .map(x => x) // with this it will work
  const results = await _([1, 2, 3]).through(mainPipeline).toArray()
  expect(results).toEqual([3, 4, 5])
})