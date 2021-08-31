const _ = require('../src')
const h = require('./helpers')

// This is a rare edge case in which a paused .take() ends with remaining data in buffer, causing an infinite end loop
// fixed destroying the stream instead of ending it in .slice()
test('overpushing a paused take', async () => {
  return new Promise(resolve => {
    const res = []
    _([1, 2, 3, 4, 5, 6])
      .collect()
      .flatten()
      .take(2)
      .pipe(h.getSlowWritable(res, 0, 0))
      .on('finish', () => {
        resolve()
        expect(res).toEqual([1, 2])
      })
  })
})

test('fork and back pressure', async () => new Promise(resolve => {
  const res = []
  const stream = _([1, 2, 3, 4, 5]).map(String)
  stream.on('end', () => console.log('stream end'))
  const l = stream.fork()
  const r = stream.fork()
  r.on('end', () => console.log('r end'))
    .take(2)
    .on('end', () => console.log('r take end'))
    .pipe(h.getSlowWritable(res, 0))
    .on('finish', () => console.log('r finish'))
  l.on('end', () => {
    console.log('l end')
    resolve()
    expect(res).toEqual(['1', '1', '2', '2', '3', '4', '5'])
  }).pipe(h.getSlowWritable(res, 0))
    .on('finish', () => console.log('l finish'))
  setImmediate(() => stream.start())
}))
