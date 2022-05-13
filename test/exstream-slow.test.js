jest.setTimeout(2000)

const _ = require('../src/index.js')
const h = require('./helpers.js')

test('backpressure', () => {
  const x = _([1, 2, 3])
  const y = []
  return new Promise(resolve => {
    const z = x.consume((err, x, push, next) => {
      if (err) {
        y.push(err)
        setTimeout(() => next(), 100)
      } else if (x !== _.nil) {
        y.push(x)
        setTimeout(() => next(), 100)
      } else {
        push(null, _.nil)
      }
    }).on('end', () => {
      expect(y).toEqual([1, 2, 3])
      resolve()
    })
    z.resume()
  })
})

test('async filter', async () => {
  const res = await _([1, 2, 3])
    .asyncFilter(async x => {
      await h.sleep(10)
      return x % 2 === 0
    })
    .toPromise()

  expect(res).toEqual([2])
})

test('slow writes on node stream', () => {
  const res = []
  return new Promise(resolve => {
    _([2, 3, 4])
      .map(x => x * 2)
      .pipe(h.getSlowWritable(res))
      .on('finish', () => {
        resolve()
        expect(res).toEqual([4, 6, 8])
      })
  })
})

test('throttle', async () => {
  const gen = async function * () {
    for (let i = 0; i < 10; i++) {
      await h.sleep(8)
      yield i
    }
  }

  const res = await _(gen())
    .throttle(50)
    .toPromise()

  expect(res.length).toBeLessThan(4)
  expect(res.length).toBeGreaterThan(1)
})
