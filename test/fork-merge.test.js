const _ = require('../src/index.js')

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
    source.fork().map(i => i * 2).tap(console.log),
    source.fork().map(async i => i * 3).resolve().tap(console.log),
  ]).merge()
    .toArray(results => {
      console.log(results)
      expect(results).toEqual([2, 4, 3, 6])
      done()
    })
  source.start()
})

test('fork and merging with promises in second fork', done => {
  const source = _([1, 2])
  _([
    source.fork().map(async i => i * 2).resolve().tap(console.log),
    source.fork().map(i => i * 3).tap(console.log),
  ]).merge()
    .toArray(results => {
      expect(results).toEqual([2, 4, 3, 6])
      done()
    })
  source.start()
})

test('fork and merging basics with toPromise', async () => {
  const source = _([1, 2, 3, 4])
  source.start()
  const results = await _([
    source.fork().map(i => i * 2),
    source.fork().map(i => i * 3),
  ]).merge()
    .toPromise()
  console.log(results)
})
