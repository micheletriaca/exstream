const { Readable } = require('node:stream')
const _ = require('../src/index.js')

const oneByteChunks = (input) => [...Buffer.from(input)].map((byte) => Buffer.from([byte]))

test.each(['§', '💩', '||'])(
  'csv parses the complete %s separator even across chunk boundaries',
  async (separator) => {
    const input = `first${separator}second\n"left${separator}right"${separator}"say ""hello"""\n`

    const result = await _(Readable.from(oneByteChunks(input)))
      .csv({ header: true, separator })
      .toPromise()

    expect(result).toEqual([{ first: `left${separator}right`, second: 'say "hello"' }])
  },
)

test.each(['§', '💩', '||'])('csv round-trips rows with the %s separator', async (separator) => {
  const rows = [
    { first: `left${separator}right`, second: 'say "hello"' },
    { first: 'plain', second: `another${separator}value` },
  ]
  const serialized = _(rows).csvStringify({ header: true, separator }).values().join('')

  const result = await _(Readable.from(oneByteChunks(serialized)))
    .csv({ header: true, separator })
    .toPromise()

  expect(result).toEqual(rows)
})

test('csv completes a multibyte-delimited final row without a trailing newline', () => {
  expect(
    _([Buffer.from('first💩second\nleft💩right')])
      .csv({ header: true, separator: '💩' })
      .values(),
  ).toEqual([{ first: 'left', second: 'right' }])
})

test('csv round-trips a UTF-16LE dialect with Unicode quotes and fragmented tokens', async () => {
  const rows = [
    { first: 'left||right', second: 'say «hello»' },
    { first: 'multiline\r\nvalue', second: 'plain' },
  ]
  const serialized = Buffer.concat(
    _(rows)
      .csvStringify({ encoding: 'utf16le', header: true, quote: '«', separator: '||' })
      .values(),
  )
  const chunks = Array.from({ length: Math.ceil(serialized.length / 3) }, (_, index) =>
    serialized.subarray(index * 3, index * 3 + 3),
  )

  await expect(
    _(Readable.from(chunks))
      .csv({ encoding: 'utf16le', header: true, quote: '«', separator: '||' })
      .toPromise(),
  ).resolves.toEqual(rows)
})