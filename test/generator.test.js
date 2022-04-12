const _ = require('../src')
const h = require('./helpers')

test('async exstream', async () => {
  let i = -1
  const sourceStream = _(async (write, next) => {
    if (++i < 10) {
      await h.sleep(0)
      write(i)
      next()
    } else write(_.nil)
  })
  const res = await sourceStream
    .tap(() => expect(sourceStream.paused).toBe(false))
    .toPromise()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('generator backpressure', async () => {
  let i = -1
  const sourceStream = _((write, next) => {
    if (++i < 10) {
      write(i)
      next()
    } else write(_.nil)
  })

  const res = await sourceStream
    .map(async x => {
      await h.sleep(10)
      expect(sourceStream.paused).toBe(true)
      return x
    })
    .resolve()
    .toPromise()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('recursive generator', async () => {
  const gen = (i = 0) => _((write, next) => {
    if (i > 10) write(_.nil)
    else {
      write(i)
      next(gen(i + 1))
    }
  })

  const res = await _(gen()).toPromise()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('switch source', async () => {
  const gen = (i = 0) => _((write, next) => {
    if (i <= 5) {
      write(i++)
      next()
    } else next(_([6, 7, 8, 9, 10]))
  })

  const res = await _(gen()).toPromise()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('switch source + backpressure', done => {
  const gen = (i = 0) => _((write, next) => {
    if (i <= 5) {
      write(i++)
      next()
    } else next(_([6, 7, 8, 9, 10]))
  })

  const res = []
  _(gen()).pipe(h.getSlowWritable(res, 1, 0)).on('finish', () => {
    done()
    expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})
