import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { Readable, Writable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'

const [library, rowsArg, chunkBytesArg, throttleBytesArg, throttleMsArg] = process.argv.slice(2)
const rowCount = Number(rowsArg)
const chunkBytes = Number(chunkBytesArg)
const throttleBytes = Number(throttleBytesArg)
const throttleMs = Number(throttleMsArg)
const headers = ['id', 'name', 'description', 'active']

if (!['exstream', 'node-csv', 'fast-csv'].includes(library)) {
  throw Error(`unknown CSV library: ${library}`)
}
if (![rowCount, chunkBytes, throttleBytes, throttleMs].every(Number.isFinite)) {
  throw Error('invalid numeric benchmark argument')
}
if (!global.gc) throw Error('run this worker with --expose-gc')

function makeInput(rows) {
  const blocks = ['id,name,description,active\n']
  const blockRows = 10_000

  for (let start = 0; start < rows; start += blockRows) {
    const end = Math.min(start + blockRows, rows)
    const block = Array(end - start)
    for (let index = start; index < end; index++) {
      block[index - start] =
        `${index},name-${index},description-${index % 1000},${index % 2 === 0}\n`
    }
    blocks.push(block.join(''))
  }

  return Buffer.from(blocks.join(''))
}

function* chunkInput(input) {
  for (let offset = 0; offset < input.length; offset += chunkBytes) {
    yield input.subarray(offset, Math.min(offset + chunkBytes, input.length))
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

const input = makeInput(rowCount)
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
  await runPipeline(Readable.from(chunkInput(input), { objectMode: false }), sink)
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
    inputBytes: input.length,
    outputBytes: sink.bytes,
    parsedRows,
    rssDeltaBytes: Math.max(0, peakRss - baselineMemory.rss),
  }),
)