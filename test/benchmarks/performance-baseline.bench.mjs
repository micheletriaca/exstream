import { createRequire } from 'node:module'
import { bench } from 'vitest'

const require = createRequire(import.meta.url)
const _ = require('../../src/index.js')

const options = {
  iterations: 5,
  time: 100,
  warmupIterations: 2,
  warmupTime: 20,
}

const coreValues = Array.from({ length: 20_000 }, (_, index) => index)
const asyncValues = Array.from({ length: 2_000 }, (_, index) => index)
const forkValues = Array.from({ length: 5_000 }, (_, index) => index)
const joinLeftValues = Array.from({ length: 20_000 }, (_, key) => ({ key, side: 'left' }))
const joinRightValues = Array.from({ length: 20_000 }, (_, key) => ({ key, side: 'right' }))
const csvRows = Array.from(
  { length: 5_000 },
  (_, index) => `${index},name-${index},${index % 2 === 0}`,
)
const csvInput = Buffer.from(`id,name,active\n${csvRows.join('\n')}\n`)
const jsonRows = Array.from({ length: 5_000 }, (_, index) => ({
  active: index % 2 === 0,
  id: index,
  name: `name-${index}`,
}))
const jsonInput = Buffer.from(JSON.stringify({ data: { rows: jsonRows }, version: 1 }))
const jsonlInput = Buffer.from(`${jsonRows.map((row) => JSON.stringify(row)).join('\n')}\n`)

bench(
  'core synchronous map/filter pipeline (20k records)',
  async () => {
    const result = await _(coreValues)
      .map((value) => value * 2)
      .filter((value) => value % 3 === 0)
      .toArray()
    if (result.length !== 6667) throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)

bench(
  'contextual synchronous map/filter pipeline (20k records)',
  async () => {
    const result = await _(coreValues)
      .withContext((value) => ({ correlationId: value }))
      .map((value, context) => {
        context.output = value * 2
        return context.output
      })
      .filter((value, context) => context.correlationId % 3 === 0 && value >= 0)
      .toArray()
    if (result.length !== 6667) throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)

bench(
  'mapAsync(32) with fulfilled promises (2k records)',
  async () => {
    const result = await _(asyncValues)
      .map((value) => Promise.resolve(value * 2))
      .mapAsync((value) => value, { concurrency: 32, ordered: false })
      .toArray()
    if (result.length !== asyncValues.length)
      throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)

bench(
  'fork/merge fan-out (5k records, two branches)',
  async () => {
    const source = _(forkValues)
    const result = await _([
      source.fork().map((value) => value * 2),
      source.fork().map((value) => value * 3),
    ])
      .merge({ concurrency: 2, ordered: false })
      .toArray()
    if (result.length !== forkValues.length * 2)
      throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)

bench(
  'sortedJoin inner (20k records per input)',
  async () => {
    let count = 0
    await _(joinLeftValues)
      .sortedJoin(_(joinRightValues), { leftKey: 'key', rightKey: 'key' })
      .tap(() => count++)
      .drain()
    if (count !== joinLeftValues.length) throw Error(`unexpected result length: ${count}`)
  },
  options,
)

bench(
  'CSV parse and stringify (5k records)',
  async () => {
    const result = await _([csvInput])
      .csv({ header: true })
      .csvStringify({ header: true })
      .toArray()
    if (result.length !== csvRows.length + 1)
      throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)

bench(
  'JSON path parse and stringify (5k records)',
  async () => {
    const result = await _([jsonInput])
      .json({ path: '$.data.rows[*]' })
      .jsonStringify({ path: '$.rows[*]' })
      .toArray()
    if (result.length !== jsonRows.length + 1)
      throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)

bench(
  'JSONL parse and stringify (5k records)',
  async () => {
    const result = await _([jsonlInput]).jsonl().jsonlStringify().toArray()
    if (result.length !== jsonRows.length) throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)