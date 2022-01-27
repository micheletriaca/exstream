const _ = require('../src/index.js')
const h = require('./helpers.js')

test('end1', () => new Promise(resolve => {
  const res = []
  const s1 = _(h.randomStringGenerator(Infinity))
  const s2 = s1.map(x => x.toUpperCase())
  const s3 = h.getSlowWritable(res, 1, 10)
  s2.pipe(s3)
  s1.once('end', () => {
    resolve()
    // expect(res.length).toBeGreaterThan(5)
    expect(s2.paused).toBe(true)
    expect(s2.ended).toBe(true)
    expect(s1.paused).toBe(true)
    expect(s1.ended).toBe(true)
  })
  setTimeout(() => s3.end(), 30)
}))

test('merge end propagation', () => new Promise(resolve => {
  const res = []
  const s1 = _(h.randomStringGenerator(Infinity))
  const s2 = _(h.randomStringGenerator(Infinity))
  const s3 = _([s1, s2]).merge(2, false)
  const s4 = h.getSlowWritable(res, 1, 10)
  s3.pipe(s4)
  s2.once('end', () => {
    resolve()
    // expect(res.length).toBeGreaterThan(5)
    expect(s2.paused).toBe(true)
    expect(s2.ended).toBe(true)
    expect(s1.paused).toBe(true)
    expect(s1.ended).toBe(true)
  })
  setTimeout(() => s3.end(), 30)
}))

test('fork end propagation', () => new Promise(resolve => {
  const s = _(h.randomStringGenerator(Infinity)).makeAsync(10)
  const s1 = s.fork().take(3)
  const s2 = s.fork()
  const s3 = _([s1, s2]).merge(2, false)
  s3.resume()
  s1.once('end', () => {
    expect(s.ended).toBe(false)
    expect(s1.ended).toBe(true)
    expect(s2.ended).toBe(false)
    expect(s3.ended).toBe(false)
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
  setTimeout(() => s3.end(), 30)
}))

test('standard end propagation', async () => {
  let s1Ended = false
  let s2Ended = false
  let s3Ended = false
  let s4Ended = false

  const res = await _([1, 2, 3])
    .on('end', () => {
      s1Ended = true
      expect(s2Ended).toBe(false)
      expect(s3Ended).toBe(false)
      expect(s4Ended).toBe(false)
    })
    .map(x => x * 2)
    .on('end', () => {
      expect(s1Ended).toBe(true)
      s2Ended = true
      expect(s3Ended).toBe(false)
      expect(s4Ended).toBe(false)
    })
    .map(x => _([x]))
    .on('end', () => {
      expect(s1Ended).toBe(true)
      expect(s2Ended).toBe(true)
      s3Ended = true
      expect(s4Ended).toBe(false)
    })
    .merge(1)
    .on('end', () => {
      expect(s1Ended).toBe(true)
      expect(s2Ended).toBe(true)
      expect(s3Ended).toBe(true)
      s4Ended = true
    })
    .toPromise()
  expect(res).toEqual([2, 4, 6])
})

// eslint-disable-next-line max-lines-per-function
test('explicit end', async () => new Promise(resolve => {
  let s1Ended = false
  let s2Ended = false
  let s3Ended = false
  let s4Ended = false

  const s = _(h.randomStringGenerator(Infinity))
    .makeAsync(10)
    .on('end', () => {
      s1Ended = true
      expect(s2Ended).toBe(true)
      expect(s3Ended).toBe(true)
      expect(s4Ended).toBe(false)
    })
    .map(x => x + '2')
    .on('end', () => {
      expect(s1Ended).toBe(false)
      s2Ended = true
      expect(s3Ended).toBe(true)
      expect(s4Ended).toBe(false)
    })
    .batch(100)
    .map(x => _(x))
    .on('end', () => {
      expect(s1Ended).toBe(false)
      expect(s2Ended).toBe(false)
      s3Ended = true
      expect(s4Ended).toBe(false)
    })

  const s2 = s
    .merge(1)
    .on('end', () => {
      expect(s1Ended).toBe(true)
      expect(s2Ended).toBe(true)
      expect(s3Ended).toBe(true)
      s4Ended = true
      resolve()
    })

  setTimeout(() => s.end(), 30)
  s2.resume()
}))

test('destroy test', () => {
  const res = []
  const s = _()
  s.consumeSync((err, x, push) => {
    if (x === _.nil) push(null, _.nil)
    else res.push(err || x)
  }).resume()
  s.write('1')
  s.write('2')
  expect(res).toEqual(['1', '2'])
  s.pause()
  s.write('3')
  s.write('4')
  expect(res).toEqual(['1', '2'])
  s.destroy()
  process.nextTick(() => expect(res).toEqual(['1', '2']))
})

test('graceful end', () => {
  const res = []
  const s = _()
  s.consumeSync((err, x, push) => {
    if (x === _.nil) push(null, _.nil)
    else res.push(err || x)
  }).resume()
  s.write('1')
  s.write('2')
  expect(res).toEqual(['1', '2'])
  s.pause()
  s.write('3')
  s.write('4')
  expect(res).toEqual(['1', '2'])
  s.end()
  process.nextTick(() => expect(res).toEqual(['1', '2', '3', '4']))
})

test('endless stream', () => new Promise(resolve => {
  const res = []
  const nodeStream = h.getSlowWritable(res, 0, 10)
  const s = _(['1', '2', '3'])
  s.pipe(nodeStream, { end: false })
  setImmediate(() => {
    resolve()
    expect(res).toEqual(['1', '2', '3'])
    expect(s.ended).toBe(true)
    expect(nodeStream.writableEnded).toBe(false)
    nodeStream.end()
    expect(nodeStream.writableEnded).toBe(true)
  })
}))
