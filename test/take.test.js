const _ = require('../src')
const h = require('./helpers')

/*
  This is a rare edge case in which a paused .take() ends with remaining data in buffer,
  causing an infinite end loop fixed destroying the stream instead of ending it in .slice()
*/
test('overpushing a paused take', async () => {
  const res = []
  await _([1, 2, 3, 4, 5, 6])
    .collect()
    .flatten()
    .take(2)
    .pipeTo(h.getSlowWritable(res, 0, 0))
  expect(res).toEqual([1, 2])
})

test('fork and back pressure', async () => {
  const res = []
  const stream = _([1, 2, 3, 4, 5]).map(String)
  // stream.on('end', () => console.log('stream end'))
  const l = stream.fork()
  const r = stream.fork()
  const rightDone = r // .on('end', () => console.log('r end'))
    .take(2)
    // .on('end', () => console.log('r take end'))
    .pipeTo(h.getSlowWritable(res, 0))
  // .on('finish', () => console.log('r finish'))
  const leftDone = l.pipeTo(h.getSlowWritable(res, 0))
  // .on('finish', () => console.log('l finish'))
  await Promise.all([rightDone, leftDone])
  expect(res).toEqual(['1', '1', '2', '2', '3', '4', '5'])
})

test('slice validation', async () => {
  let e = null
  try {
    await _([1, 2, 3, 4, 5]).slice(3, 2).toArray()
  } catch (ex) {
    e = ex
  }

  expect(e).not.toBe(null)
  expect(e.message).toBe('error in .slice(). start must be lower than end')
})

test('infinite slice', () => {
  const s = _([1, 2, 3, 4, 5])
  const s1 = s.slice(0, Infinity)
  expect(s).toBe(s1)
})

test('slice parameter validation', () => {
  let ex = null
  const s = _([1, 2, 3, 4, 5])
  const s1 = s.slice('0', 'Infinity')
  expect(s).toBe(s1)

  try {
    s.slice('test')
  } catch (e) {
    ex = e
  }

  expect(ex).not.toBe(null)
  expect(ex.message).toBe('error in .slice(). start and end must be numbers')
})

test('head', async () => {
  const res = await _([1, 2, 3]).head().single()
  expect(res).toBe(1)
})

test('last', async () => {
  const res = await _([1, 2, 3]).last().single()
  expect(res).toBe(3)
})

test('last without source', async () => {
  const res = await _([]).last().toArray()
  expect(res).toEqual([])
})