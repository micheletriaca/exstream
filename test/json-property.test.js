const _ = require('../src/index.js')

const random = (() => {
  let state = 0x5eed1234
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
})()

const pick = (values) => values[Math.floor(random() * values.length)]

const jsonValue = (depth = 0) => {
  const primitive = () =>
    pick([
      null,
      random() < 0.5,
      Math.round((random() - 0.5) * 1e8) / 100,
      pick(['', 'plain', '€', '💥', '"\\\n\t', '\u0000', 'line\nfeed']),
    ])
  if (depth >= 4 || random() < 0.45) return primitive()
  if (random() < 0.5) {
    return Array.from({ length: Math.floor(random() * 5) }, () => jsonValue(depth + 1))
  }
  const object = {}
  for (let index = 0; index < Math.floor(random() * 5); index++) {
    object[pick(['a', 'b', 'nested', 'strange.name', '€']) + index] = jsonValue(depth + 1)
  }
  return object
}

const randomChunks = (text) => {
  const chunks = []
  let index = 0
  while (index < text.length) {
    const size = 1 + Math.floor(random() * 13)
    chunks.push(text.slice(index, index + size))
    index += size
  }
  return chunks
}

test('json matches JSON.parse over varied documents and arbitrary chunk boundaries', () => {
  for (let iteration = 0; iteration < 300; iteration++) {
    const expected = jsonValue()
    const input = JSON.stringify(expected)
    expect(_(randomChunks(input)).json().values()).toEqual([expected])
  }
})

test('json wildcard selection matches a reference selector over varied documents', () => {
  for (let iteration = 0; iteration < 200; iteration++) {
    const rows = Array.from({ length: Math.floor(random() * 8) }, () => jsonValue(2))
    const document = { metadata: jsonValue(2), payload: { rows }, tail: jsonValue(2) }
    const input = JSON.stringify(document)
    expect(_(randomChunks(input)).json({ path: '$.payload.rows[*]' }).values()).toEqual(rows)
  }
})

test('jsonl matches JSON.parse for varied records and byte-at-a-time input', () => {
  const records = Array.from({ length: 100 }, () => jsonValue())
  const input = records.map((value) => JSON.stringify(value)).join('\r\n')
  const chunks = [...Buffer.from(input)].map((byte) => Buffer.from([byte]))
  expect(_(chunks).jsonl().values()).toEqual(records)
})