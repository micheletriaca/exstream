import { createRequire } from 'node:module'
import { PerformanceObserver, performance } from 'node:perf_hooks'
import { Readable, Writable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { chunkBuffer, createDataset } from './csv-benchmark-data.mjs'

if (!global.gc) throw Error('CSV benchmark workers require --expose-gc')

const config = JSON.parse(process.argv[2])
const libraries = ['exstream', 'node-csv', 'fast-csv', 'csv-parser', 'papaparse']
if (!libraries.includes(config.library)) throw Error(`unknown CSV library: ${config.library}`)

const setupStartedAt = performance.now()
const dataset = createDataset(config.scenario)
const datasetSetupMs = performance.now() - setupStartedAt
const objectMode = config.scenario.mode === 'object'
let firstRecordMs = null
let startedAt
let processedRecords = 0

const markRecord = () => {
  processedRecords++
  if (firstRecordMs === null) firstRecordMs = performance.now() - startedAt
}

class ObjectSink extends Writable {
  constructor() {
    super({ objectMode: true })
  }

  firstOutputMs = null

  _write(value, encoding, callback) {
    if (this.firstOutputMs === null) this.firstOutputMs = performance.now() - startedAt
    callback()
  }
}

class ByteSink extends Writable {
  #unthrottledBytes = 0

  constructor() {
    super({ highWaterMark: config.scenario.chunkBytes })
  }

  bytes = 0
  firstOutputMs = null

  _write(value, encoding, callback) {
    if (this.firstOutputMs === null) this.firstOutputMs = performance.now() - startedAt
    const bytes = Buffer.byteLength(value, encoding)
    this.bytes += bytes
    const { throttleBytes, throttleMs } = config.scenario
    if (throttleBytes === 0 || throttleMs === 0) {
      callback()
      return
    }
    this.#unthrottledBytes += bytes
    const delays = Math.floor(this.#unthrottledBytes / throttleBytes)
    this.#unthrottledBytes %= throttleBytes
    if (delays > 0) setTimeout(callback, delays * throttleMs)
    else callback()
  }
}

const inputSource = () =>
  Readable.from(chunkBuffer(dataset.input, config.scenario.chunkBytes), { objectMode: false })
const rowSource = () =>
  Readable.from(
    (function* () {
      for (const row of dataset.rows()) {
        processedRecords++
        yield row
      }
    })(),
  )
const require = createRequire(import.meta.url)

const prepareExstreamPipeline = () => {
  const exstream = require('../../src/index.js')
  return async () => {
    const byteSink = new ByteSink()
    const objectSink = new ObjectSink()
    if (config.scenario.operation === 'parse') {
      exstream(inputSource()).csv({ header: objectMode }).tap(markRecord).pipe(objectSink)
      await finished(objectSink)
      return { firstOutputMs: objectSink.firstOutputMs, outputBytes: 0 }
    }
    if (config.scenario.operation === 'stringify') {
      exstream(rowSource()).csvStringify({ header: objectMode }).pipe(byteSink)
      await finished(byteSink)
      return { firstOutputMs: byteSink.firstOutputMs, outputBytes: byteSink.bytes }
    }
    exstream(inputSource())
      .csv({ header: objectMode })
      .tap(markRecord)
      .csvStringify({ header: objectMode })
      .pipe(byteSink)
    await finished(byteSink)
    return { firstOutputMs: byteSink.firstOutputMs, outputBytes: byteSink.bytes }
  }
}

const prepareNodeCsvPipeline = async () => {
  const [{ parse }, { stringify }] = await Promise.all([
    import('csv-parse'),
    import('csv-stringify'),
  ])
  return async () => {
    const parser = () =>
      parse({
        columns: objectMode,
        on_record(value) {
          markRecord()
          return value
        },
      })
    const serializer = () =>
      stringify({ columns: objectMode ? dataset.headers : void 0, header: objectMode })
    const byteSink = new ByteSink()
    const objectSink = new ObjectSink()
    if (config.scenario.operation === 'parse') {
      await pipeline(inputSource(), parser(), objectSink)
      return { firstOutputMs: objectSink.firstOutputMs, outputBytes: 0 }
    }
    if (config.scenario.operation === 'stringify') {
      await pipeline(rowSource(), serializer(), byteSink)
      return { firstOutputMs: byteSink.firstOutputMs, outputBytes: byteSink.bytes }
    }
    await pipeline(inputSource(), parser(), serializer(), byteSink)
    return { firstOutputMs: byteSink.firstOutputMs, outputBytes: byteSink.bytes }
  }
}

const prepareFastCsvPipeline = async () => {
  const { format, parse } = await import('fast-csv')
  return async () => {
    const parser = () =>
      parse({ headers: objectMode }).transform((value) => {
        markRecord()
        return value
      })
    const serializer = () =>
      format({
        headers: objectMode ? dataset.headers : false,
        includeEndRowDelimiter: true,
        writeHeaders: objectMode,
      })
    const byteSink = new ByteSink()
    const objectSink = new ObjectSink()
    if (config.scenario.operation === 'parse') {
      await pipeline(inputSource(), parser(), objectSink)
      return { firstOutputMs: objectSink.firstOutputMs, outputBytes: 0 }
    }
    if (config.scenario.operation === 'stringify') {
      await pipeline(rowSource(), serializer(), byteSink)
      return { firstOutputMs: byteSink.firstOutputMs, outputBytes: byteSink.bytes }
    }
    await pipeline(inputSource(), parser(), serializer(), byteSink)
    return { firstOutputMs: byteSink.firstOutputMs, outputBytes: byteSink.bytes }
  }
}

const prepareCsvParserPipeline = () => {
  if (config.scenario.operation !== 'parse' || !objectMode) {
    throw Error('CSV Parser only supports object-mode parse benchmarks')
  }
  const csvParser = require('csv-parser')
  return async () => {
    const parser = csvParser()
    parser.on('data', markRecord)
    const objectSink = new ObjectSink()
    await pipeline(inputSource(), parser, objectSink)
    return { firstOutputMs: objectSink.firstOutputMs, outputBytes: 0 }
  }
}

const preparePapaParsePipeline = () => {
  if (config.scenario.operation !== 'parse') {
    throw Error('Papa Parse only supports parse benchmarks')
  }
  const Papa = require('papaparse')
  return async () => {
    const parser = Papa.parse(Papa.NODE_STREAM_INPUT, { header: objectMode })
    parser.on('data', markRecord)
    const objectSink = new ObjectSink()
    await pipeline(inputSource(), parser, objectSink)
    return { firstOutputMs: objectSink.firstOutputMs, outputBytes: 0 }
  }
}

const prepareRunners = {
  'csv-parser': prepareCsvParserPipeline,
  exstream: prepareExstreamPipeline,
  'fast-csv': prepareFastCsvPipeline,
  'node-csv': prepareNodeCsvPipeline,
  papaparse: preparePapaParsePipeline,
}

const librarySetupStartedAt = performance.now()
const runPipeline = await prepareRunners[config.library]()
const librarySetupMs = performance.now() - librarySetupStartedAt

global.gc()
global.gc()
const baseline = process.memoryUsage()
let peak = baseline
const sampleMemory = () => {
  const memory = process.memoryUsage()
  peak = Object.fromEntries(
    Object.keys(memory).map((key) => [key, Math.max(peak[key] || 0, memory[key])]),
  )
}
let gcCount = 0
let gcDurationMs = 0
const gcObserver = new PerformanceObserver((list) => {
  const entries = list.getEntries()
  gcCount += entries.length
  for (const entry of entries) gcDurationMs += entry.duration
})
gcObserver.observe({ entryTypes: ['gc'] })
const sampler = setInterval(sampleMemory, config.memorySampleMs)
sampler.unref()

startedAt = performance.now()
let output
try {
  output = await runPipeline()
} finally {
  clearInterval(sampler)
  sampleMemory()
  await new Promise((resolve) => setImmediate(resolve))
  gcObserver.disconnect()
}
const elapsedMs = performance.now() - startedAt

if (processedRecords !== config.scenario.rows) {
  throw Error(
    `${config.library} processed ${processedRecords} rows; expected ${config.scenario.rows}`,
  )
}
if (output.firstOutputMs === null) throw Error(`${config.library} produced no output`)
if (config.scenario.operation !== 'parse' && output.outputBytes !== dataset.inputBytes) {
  throw Error(
    `${config.library} produced ${output.outputBytes} bytes; expected ${dataset.inputBytes}`,
  )
}

const delta = (key) => Math.max(0, peak[key] - baseline[key])
process.stdout.write(
  JSON.stringify({
    allocationBytes: null,
    allocationCount: null,
    arrayBuffersDeltaBytes: delta('arrayBuffers'),
    elapsedMs,
    externalDeltaBytes: delta('external'),
    firstOutputMs: output.firstOutputMs,
    firstRecordMs,
    gcCount,
    gcDurationMs,
    heapDeltaBytes: delta('heapUsed'),
    heapPeakBytes: peak.heapUsed,
    heapStartBytes: baseline.heapUsed,
    inputBytes: dataset.inputBytes,
    librarySetupMs,
    outputBytes: output.outputBytes,
    processedRecords,
    rssDeltaBytes: delta('rss'),
    rssPeakBytes: peak.rss,
    rssStartBytes: baseline.rss,
    sampleRows: dataset.sampleRows,
    datasetSetupMs,
  }),
)