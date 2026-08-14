const { Readable } = require('node:stream')
const { parse } = require('csv-parse/sync')
const { stringify } = require('csv-stringify/sync')
const _ = require('../src/index.js')

vi.setConfig({ testTimeout: 10_000 })

const chunkBySizes = (input, sizes) => {
  const bytes = Buffer.from(input)
  const chunks = []
  let offset = 0
  let index = 0
  while (offset < bytes.length) {
    const size = sizes[index++ % sizes.length]
    chunks.push(bytes.subarray(offset, Math.min(offset + size, bytes.length)))
    offset += size
  }
  return chunks
}

const random = (seed) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

const atoms = [
  '',
  'plain',
  'with,comma',
  'say "hello"',
  'first\nsecond',
  'first\r\nsecond',
  ' leading',
  'trailing ',
  '€漢字💥',
  '"',
  ',',
  '\n',
]

const generateRows = (seed) => {
  const next = random(seed)
  const columns = 1 + Math.floor(next() * 8)
  const rows = 1 + Math.floor(next() * 16)
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      const atom = atoms[Math.floor(next() * atoms.length)]
      const suffix = next() < 0.4 ? `-${seed}-${row}-${column}` : ''
      return atom + suffix
    }),
  )
}

test('CSV parsing is invariant across every single chunk boundary', async () => {
  const expected = [
    ['id', 'description', 'note'],
    ['1', 'multiline\nvalue', 'say "hello"'],
    ['2', 'plain', 'carriage\r\nreturn'],
  ]
  const input = stringify(expected, { quoted: true, record_delimiter: '\r\n' })
  const bytes = Buffer.from(input)

  for (let boundary = 1; boundary < bytes.length; boundary++) {
    const chunks = [bytes.subarray(0, boundary), bytes.subarray(boundary)]
    // Sequential checks make the failing byte boundary deterministic.
    await expect(
      _(chunks).csv({ skipEmptyLines: false }).toPromise(),
      `boundary ${boundary}`,
    ).resolves.toEqual(expected)
  }
})

test('CSV parser matches the reference parser for deterministic generated records', async () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rows = generateRows(seed)
    const input = stringify(rows)
    const expected = parse(input, { relax_column_count: true })
    const chunks = chunkBySizes(input, [1, (seed % 7) + 1, 13, 2])

    // Sequential seeds keep failures reproducible and avoid hiding shared-state bugs.
    await expect(
      _(chunks).csv({ skipEmptyLines: false }).toPromise(),
      `seed ${seed}`,
    ).resolves.toEqual(expected)
  }
})

test('CSV serializer matches the reference parser for deterministic generated records', () => {
  for (let seed = 101; seed <= 200; seed++) {
    const rows = generateRows(seed)
    const serialized = _(rows).csvStringify().values().join('')

    expect(parse(serialized, { relax_column_count: true }), `seed ${seed}`).toEqual(rows)
  }
})

test('object-mode CSV round-trips generated headers and values', async () => {
  for (let seed = 201; seed <= 240; seed++) {
    const rows = generateRows(seed)
    const headers = rows[0].map((_, index) => `column-${index}`)
    const objects = rows.map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index]])),
    )
    const serialized = _(objects).csvStringify({ header: true }).values().join('')
    const chunks = chunkBySizes(serialized, [3, 1, 5, 2])

    await expect(
      _(chunks).csv({ header: true, skipEmptyLines: false }).toPromise(),
      `seed ${seed}`,
    ).resolves.toEqual(objects)
  }
})

test('a large record survives input fragmented into three-byte chunks', async () => {
  const value = 'a'.repeat(128 * 1024)
  const input = Buffer.from(`id,value\n1,"${value}"\n`)
  function* chunks() {
    for (let offset = 0; offset < input.length; offset += 3) {
      yield input.subarray(offset, offset + 3)
    }
  }

  await expect(_(Readable.from(chunks())).csv({ header: true }).toPromise()).resolves.toEqual([
    { id: '1', value },
  ])
})

test('deterministic malformed-input fuzzing always returns rows or a located CSV error', async () => {
  const startSeed = Number(process.env.CSV_FUZZ_SEED || 1)
  const cases = Number(process.env.CSV_FUZZ_CASES || 200)
  const alphabet = ['a', 'b', ',', '"', '\r', '\n', '€']

  for (let seed = startSeed; seed < startSeed + cases; seed++) {
    const next = random(seed)
    const length = 1 + Math.floor(next() * 128)
    const input = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join(
      '',
    )
    const chunks = chunkBySizes(input, [1 + Math.floor(next() * 7), 1, 3])
    try {
      const rows = await _(chunks).csv({ skipEmptyLines: false }).toPromise()
      expect(
        rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string')),
      ).toBe(true)
    } catch (error) {
      expect(error, `seed ${seed}`).toBeInstanceOf(_.CsvParseError)
      expect(error, `seed ${seed}`).toMatchObject({
        column: expect.any(Number),
        line: expect.any(Number),
        record: expect.any(Number),
      })
    }
  }
})