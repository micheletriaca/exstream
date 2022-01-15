const _ = require('../src/index.js')
const h = require('./helpers.js')

test('piping an error', () => {
  const res = []
  const errs = []
  return new Promise(resolve => {
    _([1, 2, 3])
      .map(() => { throw Error('NOO') })
      .on('error', e => errs.push(e))
      .pipe(h.getSlowWritable(res, 0, 10))
      .on('finish', () => {
        resolve()
        expect(res).toEqual([])
        expect(errs.length).toBe(3)
        expect(errs[2].message).toBe('NOO')
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
      .on('error', e => errs.push(e))
      .pipe(h.getSlowWritable(res, 0, 10))
      .on('finish', () => {
        resolve()
        expect(res).toEqual([])
        expect(errs.length).toBe(3)
        expect(errs[2].message).toBe('NOO')
      })
  })
})
