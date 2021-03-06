const _ = require('../src/index.js')
const h = require('./helpers')

const database = { existing: '1' }
const query1 = jest.fn().mockImplementation(async param => database[param])
const query2 = jest.fn().mockImplementation(async param => param + 1)
const exit = jest.fn()
const sourceInput = jest.fn()

const innerPipeline = _.pipeline()
  .map(query1)
  .resolve()
  // .tap(item => console.log(item))
  .filter(result => result === '1')

const mainFlow = param => {
  const source = _([param])
    .through(innerPipeline)

  const fork1 = source
    .fork()
    .map(query2)
    .resolve()

  const fork2 = source
    .fork()

  return _([fork1, fork2])
    .merge(2, true)
    .tap(exit)
}

beforeEach(() => {
  exit.mockReset()
  sourceInput.mockReset()
})

test('through before 2 forks should be executed', async () => {
  const results = await mainFlow('existing').toPromise()
  // console.log(results)
  expect(results).toHaveLength(2)
  expect(results).toEqual(['11', '1'])
  expect(exit).toHaveBeenCalledTimes(2)
  expect(exit).toHaveBeenLastCalledWith('1')
  // expect(exit).toHaveBeenNthCalledWith(2, '1', undefined)
})

test('zero results from main pipe -> nothing goes through forks', async () => {
  const results = await mainFlow('wrong').toPromise()
  expect(results).toEqual([])
  expect(sourceInput).toHaveBeenCalledTimes(0)
  expect(exit).toHaveBeenCalledTimes(0)
})

test('pipeline with fork', async () => {
  const p = _.pipeline().map(async x => x).resolve()

  const s = _([1, 2, 3]).through(p)
  const forks = [s.fork().map(x => x * 2), s.fork().map(async x => x * 3).resolve()]
  const res = await _(forks).merge().toPromise()
  expect(res).toEqual([2, 3, 4, 6, 6, 9])
})

test('pipeline with pipe and multiple through', done => {
  const p = _.pipeline().map(async x => x * 2).resolve()
  const res = []

  _([1, 2, 3]).through(p).through(p).pipe(h.getSlowWritable(res, 0, 0)).on('finish', () => {
    done()
    expect(res).toEqual([4, 8, 12])
  })
})

test('pipeline in pipe', done => {
  const p = _.pipeline().map(async x => x * 2).resolve()
  const res = []

  _([1, 2, 3]).pipe(p).pipe(p).pipe(h.getSlowWritable(res, 0, 0)).on('finish', () => {
    done()
    expect(res).toEqual([4, 8, 12])
  })
})

test('pipeline as node stream toArray', done => {
  const p = _.pipeline().map(async x => x * 2).resolve()

  _([1, 2, 3]).pipe(p.generateStream()).toArray(res => {
    done()
    expect(res).toEqual([2, 4, 6])
  })
})

test('error propagation in async chain', async () => {
  const errs = []
  const res = await _([{ a: 0 }, { a: 1 }, { a: 2 }])
    .collect()
    .flatten()
    .map(x => ({ a: x.a === 1 ? x.b.c : x.a }))
    .map(async x => x)
    .resolve()
    .errors(e => errs.push(e))
    .toPromise()
  expect(res).toEqual([{ a: 0 }, { a: 2 }])
  expect(errs.length).toBe(1)
})

test('nested pipeline as last operation', () => {
  const innerPipeline = _.pipeline()
    .map(x => x + 1)
  const mainPipeline = _.pipeline()
    .map(x => x + 1)
    .through(innerPipeline)
    // .map(x => x) // with this it will work
  const results = _([1, 2, 3])
    .through(mainPipeline)
    .values()
  expect(results).toEqual([3, 4, 5])
})
