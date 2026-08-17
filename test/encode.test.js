const _ = require('../src')

test('encode', async () => {
  const res = (await _(['ciao', ', come va?']).encode('base64').toArray()).join('')
  expect(res).toEqual('Y2lhbywgY29tZSB2YT8=')
})

test('invalid encode', async () => {
  let ex = null
  try {
    ;(await _([1, ', come va?']).encode('base64').toArray()).join('')
  } catch (e) {
    ex = e
  }
  expect(ex).not.toBe(null)
  expect(ex.message).toBe(
    'error in .encode(). expected string, Buffer, ArrayBuffer, Array, or Array-like Object. Got number',
  )
})

test('decode', async () => {
  const res = (
    await _(['Y2l', 'hbywgY29tZSB2YT8='])
      .decode('base64')
      .map((x) => x.toString())
      .toArray()
  ).join('')
  expect(res.toString()).toEqual('ciao, come va?')
})

test('incomplete decode', async () => {
  const s = _()
  const result = s
    .decode('base64')
    .map((x) => x.toString())
    .toArray()

  s.write('Y2l')
  s.write('hbyw')
  s.end()

  const res = await result
  expect(res.join('')).toBe('ciao,')
})

test('encode buffer', async () => {
  const res = (
    await _([Buffer.from('ciao'), Buffer.from(', come va?')])
      .encode('base64')
      .toArray()
  ).join('')
  expect(res).toEqual('Y2lhbywgY29tZSB2YT8=')
})

test('encode error', async () => {
  let ex = null
  try {
    ;(
      await _([Buffer.from('ciao'), Buffer.from(', come va?')])
        .encode('md5')
        .toArray()
    ).join('')
  } catch (e) {
    ex = e
  }
  expect(ex).not.toBe(null)
  expect(ex.message).toBe('.encode() supports only base64 at the moment')
})

test('invalid decode', async () => {
  let ex = null
  try {
    ;(await _(['Y2l', 'hbywgY29tZSB2YT8=']).decode('aes256').toArray()).join('')
  } catch (e) {
    ex = e
  }
  expect(ex).not.toBe(null)
  expect(ex.message).toBe('.decode() supports only base64 at the moment')
})