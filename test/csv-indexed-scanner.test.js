const { Readable } = require('node:stream')
const _ = require('../src/index.js')

test('CSV switches from buffered plain rows to stateful quoted chunks without losing data', async () => {
  const chunks = [
    Buffer.from('plain,'),
    Buffer.from('value\n"first\r\nsecond",'),
    Buffer.from('"say ""hello"""\r\n'),
    Buffer.from('plain,after-quoted\r\n'),
    Buffer.from('"last",tail'),
  ]

  await expect(_(Readable.from(chunks)).csv().toArray()).resolves.toEqual([
    ['plain', 'value'],
    ['first\r\nsecond', 'say "hello"'],
    ['plain', 'after-quoted'],
    ['last', 'tail'],
  ])
})

test('CSV indexed scanning preserves distinct escapes split at every byte', async () => {
  const input = String.raw`"a\\b"||"c\"d"||"e\xb"
`
  const chunks = [...Buffer.from(input)].map((byte) => Buffer.from([byte]))

  await expect(
    _(Readable.from(chunks)).csv({ escape: '\\', separator: '||' }).toArray(),
  ).resolves.toEqual([['a\\b', 'c"d', 'e\\xb']])
})

test('CSV hybrid cell accumulation preserves heavily fragmented escaped fields', async () => {
  const value = Array.from({ length: 32 }, (_, index) => `part-${index}`).join('"')
  const input = `"${value.replaceAll('"', '""')}",tail\n`
  const chunks = Array.from({ length: Math.ceil(input.length / 3) }, (_, index) =>
    Buffer.from(input.slice(index * 3, index * 3 + 3)),
  )

  await expect(_(Readable.from(chunks)).csv().toArray()).resolves.toEqual([[value, 'tail']])
})

test('CSV hybrid cell accumulation falls back by size and resets between records', async () => {
  const value = `${'a'.repeat(4 * 1024)}"${'b'.repeat(32)}`
  const input = `"${value.replaceAll('"', '""')}",""\nnext,row\n`

  await expect(
    _(Readable.from([Buffer.from(input)]))
      .csv()
      .toArray(),
  ).resolves.toEqual([
    [value, ''],
    ['next', 'row'],
  ])
})

test('CSV tracks line positions when a distinct newline escape appears inside quotes', async () => {
  const input = '"a\n\nb\n"c"'

  expect(await _([input]).csv({ escape: '\n' }).toArray()).toEqual([['a\nb"c']])
})

test('CSV indexed scanning retains an empty quoted field at end of input', async () => {
  expect(await _(['""']).csv().toArray()).toEqual([['']])
})

test('CSV indexed scanning honors fast mode with a multibyte encoding', async () => {
  const input = Buffer.from('a"b,c\n', 'utf16le')

  expect(await _([input]).csv({ encoding: 'utf16le', fastMode: true }).toArray()).toEqual([
    ['a"b', 'c'],
  ])
})

test('CSV indexed scanning handles escaped astral Unicode quotes', async () => {
  const quote = '💥'
  const input = `${quote}say ${quote}${quote}hello${quote},tail\n`

  expect(await _([input]).csv({ escape: quote, quote }).toArray()).toEqual([
    ['say 💥hello', 'tail'],
  ])
})