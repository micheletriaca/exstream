const _ = require('../src/index.js')
const h = require('./helpers.js')

test('piping an error', () => {
  const res = []
  const errs = []
  return new Promise(resolve => {
    _([1, 2, 3])
      .map(i => {
        if(i > 1) throw Error('NOO')
        return i
      })
      .pipe(h.getSlowWritable(res, 0, 10))
      .on('error', e => errs.push(e))
      .on('finish', () => {
        resolve()
        expect(res).toEqual([1])
        expect(errs.length).toBe(2)
        expect(errs[1].message).toBe('NOO')
      })
  })
})

test('piping an error with pipeline', () => {
  const res = []
  const errs = []

  const p = _.pipeline()
    .map(x => x)
    .map(() => { throw Error('NOO') })

  return new Promise(resolve => {
    _([1, 2, 3])
      .through(p.generateStream())
      .errors(e => errs.push(e))
      .pipe(h.getSlowWritable(res, 0, 10))
      .on('finish', () => {
        resolve()
        expect(res).toEqual([])
        expect(errs.length).toBe(3)
        expect(errs[2].message).toBe('NOO')
      })
  })
})

test('piping an error after promise', done => {
  const res = []
  _([1])
    .map(async x => x)
    .resolve()
    .map(() => { throw Error('an error') })
    .pipe(h.getSlowWritable(res))
    .on('error', e => {
      expect(e.message).toBe('an error')
      done()
    })
})

test('piping an error after promise with through', async () => {
  const res = []
  let err
  await _([1])
    .map(async x => x)
    .resolve()
    .map(() => { throw Error('an error') })
    .through(h.getSlowWritable(res), { writable: true })
    .toPromise()
    .catch(e => {
      err = e
    })
  expect(err.message).toBe('an error')
})
