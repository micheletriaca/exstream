const _ = require('../src/index.js')
const h = require('./helpers.js')

test('ratelimit', async () => {
  const s = _(h.randomStringGenerator(Infinity)).ratelimit(2, 10)
  setTimeout(() => s.destroy(), 100)
  const res = await s.toPromise()
  expect(res.length).toBeGreaterThanOrEqual(18)
  expect(res.length).toBeLessThanOrEqual(22)
})

test('ratelimit + super slow writer', async () => {
  return new Promise(resolve => {
    const res = []
    const s = _(h.randomStringGenerator(Infinity)).ratelimit(2, 10)
    s.pipe(h.getSlowWritable(res, 20, 20))
    setTimeout(() => {
      s.destroy()
      resolve()
      expect(res.length).toBeGreaterThanOrEqual(3)
      expect(res.length).toBeLessThanOrEqual(5)
    }, 100)
  })
})
