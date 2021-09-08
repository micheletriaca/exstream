const _ = require('../src')
const h = require('./helpers')

test('pipeline with fork', async () => {
  const p = _.pipeline().map(async x => x).resolve()

  const s = _([1, 2, 3]).through(p)
  const forks = [s.fork().map(x => x * 2), s.fork().map(async x => x * 3).resolve()]
  s.start()
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
