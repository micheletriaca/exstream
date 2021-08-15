const _ = require('../src/index.js')
const h = require('./helpers.js')

test('destroy propagation', () => {
  return new Promise(resolve => {
    const res = []
    const s1 = _(h.randomStringGenerator(Infinity))
    const s2 = s1.map(x => x.toUpperCase())
    const s3 = h.getSlowWritable(res, 1, 10)
    s2.pipe(s3)
    s1.once('end', () => {
      resolve()
      expect(res.length).toBeGreaterThan(5)
      expect(s2.paused).toBe(true)
      expect(s2.ended).toBe(true)
      expect(s1.paused).toBe(true)
      expect(s1.ended).toBe(true)
    })
    setTimeout(() => s3.destroy(), 30)
  })
})

test('merge destroy propagation', () => {
  return new Promise(resolve => {
    const res = []
    const s1 = _(h.randomStringGenerator(Infinity))
    const s2 = _(h.randomStringGenerator(Infinity))
    const s3 = _([s1, s2]).merge(2)
    const s4 = h.getSlowWritable(res, 1, 10)
    s3.pipe(s4)
    s2.once('end', () => {
      resolve()
      expect(res.length).toBeGreaterThan(5)
      expect(s2.paused).toBe(true)
      expect(s2.ended).toBe(true)
      expect(s1.paused).toBe(true)
      expect(s1.ended).toBe(true)
    })
    setTimeout(() => s3.destroy(), 30)
  })
})

test('fork destroy propagation', () => {
  return new Promise(resolve => {
    const s = _(h.randomStringGenerator(Infinity))
    const s1 = s.fork().take(3)
    const s2 = s.fork()
    const s3 = _([s1, s2]).merge(2)
    s3.resume()
    s1.once('end', () => {
      expect(s.ended).toBe(false)
      expect(s1.ended).toBe(true)
      expect(s2.ended).toBe(false)
      expect(s3.ended).toBe(true)
    })
    s2.once('end', () => {
      expect(s.ended).toBe(false)
      expect(s1.ended).toBe(true)
      expect(s2.ended).toBe(true)
      expect(s3.ended).toBe(true)
    })
    s.once('end', () => {
      resolve()
      expect(s1.ended).toBe(true)
      expect(s2.ended).toBe(true)
      expect(s3.ended).toBe(true)
      expect(s.ended).toBe(true)
    })
    setTimeout(() => s3.destroy(), 30)
  })
})
