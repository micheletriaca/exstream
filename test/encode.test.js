const _ = require('../src')

test('encode', () => {
  const res = _(['ciao', ', come va?'])
    .encode('base64')
    .values()
    .join('')
  expect(res).toEqual('Y2lhbywgY29tZSB2YT8=')
})

test('invalid encode', () => {
  let ex = null
  try {
    _([1, ', come va?'])
      .encode('base64')
      .values()
      .join('')
  } catch (e) {
    ex = e
  }
  expect(ex).not.toBe(null)
  expect(ex.message).toBe('error in .encode(). expected string, Buffer, ArrayBuffer, Array, or Array-like Object. Got number')
})

test('decode', () => {
  const res = _(['Y2l', 'hbywgY29tZSB2YT8='])
    .decode('base64')
    .map(x => x.toString())
    .values()
    .join('')
  expect(res.toString()).toEqual('ciao, come va?')
})

test('incomplete decode', done => {
  const s = _()
  s.decode('base64').map(x => x.toString()).toArray(res => {
    done()
    expect(res.join('')).toBe('ciao,')
  })

  s.write('Y2l')
  s.write('hbyw')
  s.end()
})

test('encode buffer', () => {
  const res = _([Buffer.from('ciao'), Buffer.from(', come va?')])
    .encode('base64')
    .values()
    .join('')
  expect(res).toEqual('Y2lhbywgY29tZSB2YT8=')
})

test('encode error', () => {
  let ex = null
  try {
    _([Buffer.from('ciao'), Buffer.from(', come va?')])
      .encode('md5')
      .values()
      .join('')
  } catch (e) {
    ex = e
  }
  expect(ex).not.toBe(null)
  expect(ex.message).toBe('.encode() supports only base64 at the moment')
})

test('invalid decode', () => {
  let ex = null
  try {
    _(['Y2l', 'hbywgY29tZSB2YT8='])
      .decode('aes256')
      .values()
      .join('')
  } catch (e) {
    ex = e
  }
  expect(ex).not.toBe(null)
  expect(ex.message).toBe('.decode() supports only base64 at the moment')
})
