import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

const require = createRequire(import.meta.url)
const _ = require('../../src/index.js')
const JSONStream = require('JSONStream')
const jsonStreamVersion = require('JSONStream/package.json').version

const argument = (name, fallback) => {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const rows = Number(argument('rows', '200000'))
const rounds = Number(argument('rounds', '3'))
const chunkBytes = Number(argument('chunk-bytes', String(64 * 1024)))
const mode = argument('mode', null)
const cases = [
  'json-select',
  'jsonstream-select',
  'json-select-sparse',
  'jsonstream-select-sparse',
  'json-native',
  'jsonl',
  'json-stringify',
  'jsonl-stringify',
]

const assertConfiguration = () => {
  if (!Number.isSafeInteger(rows) || rows <= 0) throw Error('--rows must be a positive integer')
  if (!Number.isSafeInteger(rounds) || rounds <= 0) {
    throw Error('--rounds must be a positive integer')
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw Error('--chunk-bytes must be a positive integer')
  }
  if (mode !== null && !cases.includes(mode)) throw Error(`unknown --mode: ${mode}`)
}

const rowText = (index) => `{"id":${index},"name":"record-${index}","active":${index % 2 === 0}}`

const chunksOf = (input) => {
  const chunks = []
  for (let offset = 0; offset < input.length; offset += chunkBytes) {
    chunks.push(input.subarray(offset, offset + chunkBytes))
  }
  return chunks
}

const createInputs = (selectedMode) => {
  const values = Array.from({ length: rows }, (_, index) => ({
    active: index % 2 === 0,
    id: index,
    name: `record-${index}`,
  }))
  const serialized = values.map((_value, index) => rowText(index))
  const ignored = selectedMode.endsWith('-sparse')
    ? `,"ignored":"${'x'.repeat(8 * 1024 * 1024)}"`
    : ''
  const json = Buffer.from(
    `{"metadata":{"source":"benchmark","version":1},"data":{"rows":[${serialized.join(',')}]},"count":${rows}${ignored}}`,
  )
  const jsonl = Buffer.from(`${serialized.join('\n')}\n`)
  return { json, jsonChunks: chunksOf(json), jsonl, jsonlChunks: chunksOf(jsonl), values }
}

const sampleMemory = (baseline, peak) => {
  const memory = process.memoryUsage()
  for (const key of ['heapUsed', 'rss', 'external', 'arrayBuffers']) {
    peak[key] = Math.max(peak[key], memory[key] - baseline[key])
  }
}

const runCase = async (selectedMode) => {
  const input = createInputs(selectedMode)
  global.gc?.()
  const baseline = process.memoryUsage()
  const peak = { arrayBuffers: 0, external: 0, heapUsed: 0, rss: 0 }
  let count = 0
  let checksum = 0
  let firstRecordMs = null
  const start = performance.now()
  const mark = (value) => {
    if (firstRecordMs === null) firstRecordMs = performance.now() - start
    count++
    checksum += typeof value === 'object' && value !== null ? value.id || 0 : 0
    if ((count & 8191) === 0) sampleMemory(baseline, peak)
  }

  if (selectedMode === 'json-select' || selectedMode === 'json-select-sparse') {
    await _(input.jsonChunks).json({ path: '$.data.rows[*]' }).tap(mark).drain()
  } else if (selectedMode === 'jsonstream-select' || selectedMode === 'jsonstream-select-sparse') {
    await new Promise((resolve, reject) => {
      const parser = JSONStream.parse(['data', 'rows', true])
      parser.on('data', mark)
      parser.once('end', resolve)
      parser.once('error', reject)
      for (const chunk of input.jsonChunks) parser.write(chunk)
      parser.end()
    })
  } else if (selectedMode === 'json-native') {
    const document = JSON.parse(input.json.toString('utf8'))
    for (const value of document.data.rows) mark(value)
  } else if (selectedMode === 'jsonl') {
    await _(input.jsonlChunks).jsonl().tap(mark).drain()
  } else if (selectedMode === 'json-stringify') {
    let outputChunks = 0
    const output = await _(input.values)
      .jsonStringify({ path: '$.data.rows[*]' })
      .tap((chunk) => {
        outputChunks++
        checksum += chunk.length
        if (firstRecordMs === null) firstRecordMs = performance.now() - start
        if ((outputChunks & 8191) === 0) sampleMemory(baseline, peak)
      })
      .reduce((chunks) => chunks + 1, 0)
      .single()
    count = input.values.length
    if (output !== count + 1) throw Error(`unexpected JSON output chunks: ${output}`)
  } else {
    let outputChunks = 0
    const output = await _(input.values)
      .jsonlStringify()
      .tap((chunk) => {
        outputChunks++
        checksum += chunk.length
        if (firstRecordMs === null) firstRecordMs = performance.now() - start
        if ((outputChunks & 8191) === 0) sampleMemory(baseline, peak)
      })
      .reduce((chunks) => chunks + 1, 0)
      .single()
    count = output
  }

  sampleMemory(baseline, peak)
  const elapsedMs = performance.now() - start
  if (count !== rows) throw Error(`unexpected record count: ${count}`)
  if (!Number.isFinite(checksum)) throw Error('invalid checksum')
  const documentInput =
    selectedMode === 'json-select' ||
    selectedMode === 'json-select-sparse' ||
    selectedMode === 'jsonstream-select' ||
    selectedMode === 'jsonstream-select-sparse' ||
    selectedMode === 'json-native'
  return {
    count,
    elapsedMs,
    firstRecordMs,
    inputMiB: (documentInput ? input.json.length : input.jsonl.length) / 2 ** 20,
    mode: selectedMode,
    peakDeltaMiB: Object.fromEntries(
      Object.entries(peak).map(([key, value]) => [key, value / 2 ** 20]),
    ),
    recordsPerSecond: (count * 1000) / elapsedMs,
  }
}

const median = (values) =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]

const runParent = () => {
  const results = []
  for (const selectedMode of cases) {
    const samples = []
    for (let round = 0; round < rounds; round++) {
      const child = spawnSync(
        process.execPath,
        [
          '--expose-gc',
          import.meta.filename,
          `--mode=${selectedMode}`,
          `--rows=${rows}`,
          `--chunk-bytes=${chunkBytes}`,
        ],
        { encoding: 'utf8' },
      )
      if (child.status !== 0) throw Error(child.stderr || child.stdout)
      samples.push(JSON.parse(child.stdout))
    }
    results.push({
      inputMiB: samples[0].inputMiB,
      medianElapsedMs: median(samples.map((sample) => sample.elapsedMs)),
      medianFirstRecordMs: median(samples.map((sample) => sample.firstRecordMs)),
      medianHeapDeltaMiB: median(samples.map((sample) => sample.peakDeltaMiB.heapUsed)),
      medianPeakDeltaMiB: Object.fromEntries(
        Object.keys(samples[0].peakDeltaMiB).map((key) => [
          key,
          median(samples.map((sample) => sample.peakDeltaMiB[key])),
        ]),
      ),
      medianRecordsPerSecond: median(samples.map((sample) => sample.recordsPerSecond)),
      mode: selectedMode,
      samples,
    })
  }
  console.log(
    JSON.stringify(
      { chunkBytes, jsonStreamVersion, node: process.version, rounds, rows, results },
      null,
      2,
    ),
  )
}

assertConfiguration()
if (mode === null) runParent()
else console.log(JSON.stringify(await runCase(mode)))