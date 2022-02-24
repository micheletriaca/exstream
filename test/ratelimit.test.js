const _ = require('../src/index.js')
const h = require('./helpers.js')

test('ratelimit', async () => {
  const s = _(h.randomStringGenerator(Infinity)).ratelimit(2, 5)
  setTimeout(() => s.destroy(), 20)
  const res = await s.toPromise()
  expect(res.length).toBeGreaterThanOrEqual(6)
  expect(res.length).toBeLessThanOrEqual(12)
})

test('generator slower than ratelimit', () => new Promise(resolve => {
  const res = []
  const s = _(async function * () {
    while (true) {
      await h.sleep(10)
      yield '1'
    }
  }()).ratelimit(2, 10)
  s.pipe(h.getSlowWritable(res, 0, 20))
  setTimeout(() => {
    s.destroy()
    resolve()
    expect(res.length).toBeGreaterThanOrEqual(3)
    expect(res.length).toBeLessThanOrEqual(5)
  }, 50)
}))
