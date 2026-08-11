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
const csvRows = Array.from(
  { length: 5_000 },
  (_, index) => `${index},name-${index},${index % 2 === 0}`,
)
const csvInput = Buffer.from(`id,name,active\n${csvRows.join('\n')}\n`)

bench(
  'core synchronous map/filter pipeline (20k records)',
  () => {
    const result = _(coreValues)
      .map((value) => value * 2)
      .filter((value) => value % 3 === 0)
      .values()
    if (result.length !== 6667) throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)

bench(
  'contextual synchronous map/filter pipeline (20k records)',
  () => {
    const result = _(coreValues)
      .withContext((value) => ({ correlationId: value }))
      .map((value, context) => {
        context.output = value * 2
        return context.output
      })
      .filter((value, context) => context.correlationId % 3 === 0 && value >= 0)
      .values()
    if (result.length !== 6667) throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)

bench(
  'resolve(32) with fulfilled promises (2k records)',
  async () => {
    const result = await _(asyncValues)
      .map((value) => Promise.resolve(value * 2))
      .resolve(32, false)
      .toPromise()
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
      .merge(2, false)
      .toPromise()
    if (result.length !== forkValues.length * 2)
      throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)

bench(
  'CSV parse and stringify (5k records)',
  () => {
    const result = _([csvInput]).csv({ header: true }).csvStringify({ header: true }).values()
    if (result.length !== csvRows.length + 1)
      throw Error(`unexpected result length: ${result.length}`)
  },
  options,
)