import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { Readable, Writable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'

const [library, rowsArg, chunkBytesArg, throttleBytesArg, throttleMsArg, sourceMode = 'buffer'] =
  process.argv.slice(2)
const rowCount = Number(rowsArg)
const chunkBytes = Number(chunkBytesArg)
const throttleBytes = Number(throttleBytesArg)
const throttleMs = Number(throttleMsArg)
const headers = ['id', 'name', 'description', 'active']

if (!['exstream', 'node-csv', 'fast-csv'].includes(library)) {
  throw Error(`unknown CSV library: ${library}`)
}
if (!['buffer', 'constant-memory'].includes(sourceMode)) {
  throw Error(`unknown source mode: ${sourceMode}`)
}
if (![rowCount, chunkBytes, throttleBytes, throttleMs].every(Number.isFinite)) {
  throw Error('invalid numeric benchmark argument')
}
if (!global.gc) throw Error('run this worker with --expose-gc')

function makeInput(rows) {
  const header = 'id,name,description,active\n'
  const digitLengthSum = (count) => {
    if (count === 0) return 0
    let sum = 1 // zero
    for (let digits = 1, start = 1; start < count; digits++, start *= 10) {
      sum += (Math.min(count, start * 10) - start) * digits
    }
    return sum
  }
  const descriptionCycleDigits = digitLengthSum(1000)
  const descriptionDigits =
    Math.floor(rows / 1000) * descriptionCycleDigits + digitLengthSum(rows % 1000)
  const bytes =
    Buffer.byteLength(header) +
    rows * 25 +
    digitLengthSum(rows) * 2 +
    descriptionDigits +
    Math.floor(rows / 2)
  const input = Buffer.allocUnsafe(bytes)
  let offset = input.write(header)

  for (let index = 0; index < rows; index++) {
    offset += input.write(
      `${index},name-${index},description-${index % 1000},${index % 2 === 0}\n`,
      offset,
    )
  }

  if (offset !== bytes) throw Error(`generated ${offset} CSV bytes; expected ${bytes}`)

  return input
}

function* chunkInput(input) {
  for (let offset = 0; offset < input.length; offset += chunkBytes) {
    yield input.subarray(offset, Math.min(offset + chunkBytes, input.length))
  }
}

function makeConstantMemoryInput(rows) {
  const header = Buffer.from('id,name,description,active\n')
  const row = '123456,name-123456,description-456,true\n'
  const rowBytes = Buffer.byteLength(row)
  const rowsPerChunk = Math.floor(chunkBytes / rowBytes)
  const fullChunk = Buffer.from(row.repeat(rowsPerChunk))
  const fullChunks = Math.floor(rows / rowsPerChunk)
  const remainder = Buffer.from(row.repeat(rows % rowsPerChunk))

  return {
    bytes: header.length + rows * rowBytes,
    source() {
      function* chunks() {
        yield header
        for (let index = 0; index < fullChunks; index++) yield fullChunk
        if (remainder.length > 0) yield remainder
      }
      return Readable.from(chunks(), { objectMode: false })
    },
  }
}

class BenchmarkSink extends Writable {
  #startedAt
  #unthrottledBytes = 0

  constructor(startedAt) {
    super({ highWaterMark: chunkBytes })
    this.#startedAt = startedAt
  }

  bytes = 0
  firstByteMs = null

  _write(chunk, encoding, callback) {
    if (this.firstByteMs === null) this.firstByteMs = performance.now() - this.#startedAt
    this.bytes += Buffer.byteLength(chunk, encoding)

    if (throttleBytes === 0 || throttleMs === 0) {
      callback()
      return
    }

    this.#unthrottledBytes += Buffer.byteLength(chunk, encoding)
    const delays = Math.floor(this.#unthrottledBytes / throttleBytes)
    this.#unthrottledBytes %= throttleBytes
    if (delays > 0) setTimeout(callback, delays * throttleMs)
    else callback()
  }
}

const require = createRequire(import.meta.url)
let runPipeline
let parsedRows = 0

if (library === 'exstream') {
  const exstream = require('../../src/index.js')
  runPipeline = async (source, sink) => {
    exstream(source)
      .csv({ header: true })
      .tap(() => parsedRows++)
      .csvStringify({ header: true })
      .pipe(sink)
    await finished(sink)
  }
} else if (library === 'node-csv') {
  const [{ parse }, { stringify }] = await Promise.all([
    import('csv-parse'),
    import('csv-stringify'),
  ])
  runPipeline = (source, sink) =>
    pipeline(
      source,
      parse({
        columns: true,
        on_record(record) {
          parsedRows++
          return record
        },
      }),
      stringify({ columns: headers, header: true }),
      sink,
    )
} else {
  const { format, parse } = await import('fast-csv')
  runPipeline = (source, sink) =>
    pipeline(
      source,
      parse({ headers: true }).transform((row) => {
        parsedRows++
        return row
      }),
      format({ headers, includeEndRowDelimiter: true, writeHeaders: true }),
      sink,
    )
}

const input =
  sourceMode === 'constant-memory'
    ? makeConstantMemoryInput(rowCount)
    : (() => {
        const buffer = makeInput(rowCount)
        return {
          bytes: buffer.length,
          source: () => Readable.from(chunkInput(buffer), { objectMode: false }),
        }
      })()
global.gc()
global.gc()

const baselineMemory = process.memoryUsage()
let peakHeapUsed = baselineMemory.heapUsed
let peakRss = baselineMemory.rss
const sampleMemory = () => {
  const memory = process.memoryUsage()
  peakHeapUsed = Math.max(peakHeapUsed, memory.heapUsed)
  peakRss = Math.max(peakRss, memory.rss)
}
const memorySampler = setInterval(sampleMemory, 10)
memorySampler.unref()

const startedAt = performance.now()
const sink = new BenchmarkSink(startedAt)
try {
  await runPipeline(input.source(), sink)
} finally {
  clearInterval(memorySampler)
  sampleMemory()
}
const elapsedMs = performance.now() - startedAt

if (parsedRows !== rowCount) {
  throw Error(`${library} parsed ${parsedRows} rows; expected ${rowCount}`)
}
if (sink.bytes === 0 || sink.firstByteMs === null) {
  throw Error(`${library} produced no CSV output`)
}

process.stdout.write(
  JSON.stringify({
    elapsedMs,
    firstByteMs: sink.firstByteMs,
    heapDeltaBytes: Math.max(0, peakHeapUsed - baselineMemory.heapUsed),
    inputBytes: input.bytes,
    outputBytes: sink.bytes,
    parsedRows,
    rssDeltaBytes: Math.max(0, peakRss - baselineMemory.rss),
  }),
)