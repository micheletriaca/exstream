const _ = require('../src/index.js')
const h = require('./helpers.js')

test('merging basics', done => {
  _([
    _([1, 2]),
    _([3, 4]),
  ]).merge(1)
    .toArray(results => {
      done()
      expect(results).toEqual([1, 2, 3, 4])
    })
})

test('fork and merging basics', done => {
  const source = _([1, 2])
  _([
    source.fork().map(i => i * 2),
    source.fork().map(i => i * 3),
  ]).merge()
    .toArray(results => {
      done()
      expect(results).toEqual([2, 3, 4, 6])
    })
})

test('fork and merging basics - preserve order', done => {
  const source = _([1, 2], 'source')
  _([
    source.fork().map(i => i * 2),
    source.fork().map(i => i * 3),
  ], 'merge').merge(2, true)
    .toArray(results => {
      done()
      expect(results).toEqual([2, 4, 3, 6])
    })
})

test('fork and merging with promises in first fork', done => {
  const source = _([1, 2])
  _([
    source.fork().map(async i => i * 2).resolve().tap(console.log),
    source.fork().map(i => i * 3).tap(console.log),
  ]).merge(2, true)
    .toArray(results => {
      done()
      expect(results).toEqual([2, 4, 3, 6])
    })
})

test('fork and merging with promises in second fork', done => {
  const source = _([1, 2])
  _([
    source.fork().map(i => i * 2).tap(console.log),
    source.fork().map(async i => i * 3).resolve().tap(console.log),
  ]).merge(1)
    .toArray(results => {
      expect(results).toEqual([2, 4, 3, 6])
      done()
    })
})

test('fork and merging basics with toPromise', async () => {
  const source = _([1, 2, 3, 4])
  const first = source.fork().map(i => i * 2)
  const second = source.fork().map(i => i * 3)
  const results = await _([
    first,
    second,
  ]).merge(2, true)
    .toPromise()
  expect(results).toEqual([2, 4, 6, 8, 3, 6, 9, 12])
})

test('fork and merging - promise in the source stream as well', async () => {
  const source = _([1, 2, 3, 4]).map(async i => i + 1).resolve()
  const first = source.fork().map(async i => i * 2).resolve()
  const second = source.fork().map(async i => i * 3).resolve()
  const results = await _([
    first,
    second,
  ]).merge(2, true)
    .toPromise()
  console.log(results)
  expect(results).toEqual([4, 6, 8, 10, 6, 9, 12, 15])
})

test('consuming fork in different "transactions" throw exception', done => {
  const source = _([1, 2, 3])
  source.fork().toArray(res => {
    console.log(res)
  })
  setTimeout(() => {
    let ex
    try {
      source.fork().map(x => x * 2).toArray(res => {
        expect(true).toBe(false)
      })
    } catch (e) {
      ex = e
    }
    done()
    expect(ex).not.toBe(null)
    expect(ex.message).toBe('this stream is already started. you can\'t fork it anymore')
  }, 10)
})

test('consuming fork in different "transactions" with disable autostart', done => {
  const source = _([1, 2, 3])
  source.fork(true).toArray(res => {
    expect(res).toEqual([1, 2, 3])
  })
  setTimeout(() => {
    source.fork().map(x => x * 2).toArray(res => {
      done()
      expect(res).toEqual([2, 4, 6])
    })
    source.start()
  }, 10)
})

test('consuming fork in setImmediate or nextTick works', done => {
  const finished = jest.fn()
  const source = _([1, 2, 3])
  source.fork().toArray(res => {
    finished()
    expect(res).toEqual([1, 2, 3])
  })
  process.nextTick(() => {
    source.fork().map(x => x * 2).toArray(res => {
      finished()
      expect(res).toEqual([2, 4, 6])
    })
  })
  setImmediate(() => {
    source.fork().map(x => x * 2).toArray(res => {
      finished()
      done()
      expect(res).toEqual([2, 4, 6])
      expect(finished).toHaveBeenCalledTimes(3)
    })
  })
})

test('take() in a fork', async () => {
  const source = _([1, 2, 3, 4]).map(async i => i + 1).resolve()
  const results = await _([
    source.fork().map(async i => i * 2).resolve(),
    source.fork().take(1).map(async i => i * 3).resolve(),
  ]).merge(2, true)
    .toPromise()
  expect(results).toEqual([4, 6, 8, 10, 6])
})

test('merging1', async () => new Promise((resolve) => {
  const res = []
  const s = _([1, 2, 3])
  _([
    s.fork().map(x => x * 2 + 1),
    s.fork().map(x => x * 2 + 2),
    s.fork().map(x => x * 2 + 3),
  ]).merge(3, false)
    .pipe(h.getSlowWritable(res, 5))
    .on('finish', () => {
      expect(res).toEqual([3, 4, 5, 5, 6, 7, 7, 8, 9])
      resolve()
    })
}))

test('merging3', async () => {
  let excep = false
  await _([1, 2])
    .merge()
    .toPromise()
    .catch(e => {
      excep = true
    })
  expect(excep).toBe(true)
})
