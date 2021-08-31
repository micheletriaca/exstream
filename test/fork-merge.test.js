const _ = require('../src/index.js')
const h = require('./helpers.js')

test('merging basics', done => {
  _([
    _([1, 2]),
    _([3, 4]),
  ]).merge()
    .toArray(results => {
      expect(results).toEqual([1, 2, 3, 4])
      done()
    })
})

test('fork and merging basics', done => {
  const source = _([1, 2])
  _([
    source.fork().map(i => i * 2),
    source.fork().map(i => i * 3),
  ]).merge()
    .toArray(results => {
      expect(results).toEqual([2, 4, 3, 6])
      done()
    })
  source.start()
})

test('fork and merging with promises in first fork', done => {
  const source = _([1, 2])
  _([
    source.fork().map(async i => i * 2).resolve().tap(console.log),
    source.fork().map(i => i * 3).tap(console.log),
  ]).merge(2)
    .toArray(results => {
      expect(results).toEqual([2, 4, 3, 6])
      done()
    })
  source.start()
})

test('fork and merging with promises in second fork', done => {
  const source = _([1, 2])
  _([
    source.fork().map(i => i * 2).tap(console.log),
    source.fork().map(async i => i * 3).resolve().tap(console.log),
  ]).merge()
    .toArray(results => {
      expect(results).toEqual([2, 4, 3, 6])
      done()
    })
  source.start()
})

test('fork and merging basics with toPromise', async () => {
  const source = _([1, 2, 3, 4])
  const first = source.fork().map(i => i * 2)
  const second = source.fork().map(i => i * 3)
  source.start()
  const results = await _([
    first,
    second,
  ]).merge(2)
    .toPromise()
  console.log(results)
})

test('fork and merging - promise in the source stream as well', async () => {
  const source = _([1, 2, 3, 4]).map(async i => i + 1).resolve()
  const first = source.fork().map(async i => i * 2).resolve()
  const second = source.fork().map(async i => i * 3).resolve()
  source.start()
  const results = await _([
    first,
    second,
  ]).merge(2)
    .toPromise()
  console.log(results)
})

test('merging1', async () => new Promise((resolve) => {
  const res = []
  const s = _([1, 2, 3])
  _([
    s.fork().map(x => x * 2 + 1),
    s.fork().map(x => x * 2 + 2),
    s.fork().map(x => x * 2 + 3),
  ]).merge(3, false)
    .pipe(h.getSlowWritable(res))
    .on('finish', () => {
      expect(res).toEqual([3, 4, 5, 5, 6, 7, 7, 8, 9])
      resolve()
    })
  s.start()
}))

test('merging3', async () => {
  let excep = false
  await _([1, 2])
    .merge()
    .toPromise()
    .catch(e => {
      excep = true
    })
  expect(excep).toBe(true)
})
