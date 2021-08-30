const _ = require('../src/index.js')
const h = require('./helpers.js')

test('ratelimit', async () => {
  const s = _(h.randomStringGenerator(Infinity)).ratelimit(1, 10)
  setTimeout(() => s.destroy(), 55)
  const res = await s.toPromise()
  expect(res.length).toBeGreaterThanOrEqual(5)
  expect(res.length).toBeLessThanOrEqual(6)
})
