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