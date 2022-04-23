const _ = require('../src/index.js')

test('split', () => {
  const b = [Buffer.from('line1\nli'), Buffer.from('ne2\r\n'), Buffer.from('line3')]
  const res = _(b).split().values()
  expect(res).toEqual(['line1', 'line2', 'line3'])
})

test('splitBy', () => {
  const b = [Buffer.from('||line1||li'), Buffer.from('ne2||'), Buffer.from('line3||line4||')]
  const res = _(b).splitBy('||').values()
  expect(res).toEqual(['', 'line1', 'line2', 'line3', 'line4', ''])
})

test('splitBy with different encodings', () => {
  const b = [
    Buffer.from('line1||li', 'utf16le'),
    Buffer.from('ne2||', 'utf16le'),
    Buffer.from('line3||line4', 'utf16le'),
  ]
  const res = _(b).splitBy('||', 'utf16le').values()
  expect(res).toEqual(['line1', 'line2', 'line3', 'line4'])
})

test('split with multibyte chars', done => {
  const b = [
    'line1',
    Buffer.from('\n'),
    'line2',
    Buffer.from([0x0a /* \n */, 0xf0, 0x9f]),
    Buffer.from([0x98, 0x8f])]
  _(b).split().toArray(res => {
    done()
    expect(res).toEqual(['line1', 'line2', '😏'])
  })
})
