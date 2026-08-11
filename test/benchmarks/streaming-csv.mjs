import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const workerPath = join(root, 'test/benchmarks/streaming-csv.worker.mjs')
const memoryScaling = process.argv.includes('--memory-scaling')
const baselinePath = join(
  root,
  memoryScaling
    ? 'test/benchmarks/streaming-csv-memory-baseline.json'
    : 'test/benchmarks/streaming-csv-baseline.json',
)
const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

const libraries = [
  { id: 'exstream', name: 'Exstream', version: packageJson.version },
  {
    id: 'node-csv',
    name: 'Node CSV',
    version:
      `${packageLock.packages['node_modules/csv-parse'].version} / ` +
      packageLock.packages['node_modules/csv-stringify'].version,
  },
  {
    id: 'fast-csv',
    name: 'Fast-CSV',
    version: packageLock.packages['node_modules/fast-csv'].version,
  },
]
const throttledScenario = { id: '32-mib-s-sink', throttleBytes: 64 * 1024, throttleMs: 2 }
const scenarios = memoryScaling
  ? [throttledScenario]
  : [{ id: 'fast-sink', throttleBytes: 0, throttleMs: 0 }, throttledScenario]
const rowCounts = memoryScaling ? [50_000, 500_000, 5_000_000] : [500_000]
const config = {
  chunkBytes: 64 * 1024,
  measuredRuns: 3,
  memorySampleMs: 10,
  rows: memoryScaling ? rowCounts : rowCounts[0],
  warmupRuns: memoryScaling ? 0 : 1,
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits))
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function runWorker(library, scenario, rowCount) {
  const child = spawn(
    process.execPath,
    [
      '--expose-gc',
      workerPath,
      library.id,
      String(rowCount),
      String(config.chunkBytes),
      String(scenario.throttleBytes),
      String(scenario.throttleMs),
      memoryScaling ? 'constant-memory' : 'buffer',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
  const [exitCode] = await once(child, 'close')

  if (exitCode !== 0) {
    throw Error(`${library.name} worker exited with ${exitCode}:\n${stderr || stdout}`)
  }

  const raw = JSON.parse(stdout)
  return {
    elapsedMs: round(raw.elapsedMs),
    firstByteMs: round(raw.firstByteMs),
    heapDeltaMiB: round(raw.heapDeltaBytes / 1024 / 1024),
    inputBytes: raw.inputBytes,
    inputMiBPerSecond: round(raw.inputBytes / 1024 / 1024 / (raw.elapsedMs / 1000)),
    outputBytes: raw.outputBytes,
    rssDeltaMiB: round(raw.rssDeltaBytes / 1024 / 1024),
  }
}

function summarize(samples) {
  return Object.fromEntries(
    Object.keys(samples[0]).map((metric) => [metric, round(median(samples.map((x) => x[metric])))]),
  )
}

const results = []
for (const rowCount of rowCounts) {
  for (const scenario of scenarios) {
    const samplesByLibrary = new Map(libraries.map((library) => [library.id, []]))
    process.stderr.write(`\n${scenario.id}, ${rowCount.toLocaleString('en-US')} rows\n`)

    for (let roundIndex = 0; roundIndex < config.warmupRuns + config.measuredRuns; roundIndex++) {
      const rotated = libraries.map(
        (_, index) => libraries[(index + roundIndex) % libraries.length],
      )
      for (const library of rotated) {
        // Sequential execution avoids CPU and memory contention between benchmark workers.
        // eslint-disable-next-line no-await-in-loop
        const sample = await runWorker(library, scenario, rowCount)
        const warmup = roundIndex < config.warmupRuns
        const measuredRun = roundIndex - config.warmupRuns + 1
        process.stderr.write(
          `${warmup ? 'warmup' : `run ${measuredRun}`}: ${library.name} ` +
            `${sample.elapsedMs} ms, ${sample.inputMiBPerSecond} MiB/s, ` +
            `${sample.rssDeltaMiB} MiB RSS\n`,
        )
        if (!warmup) samplesByLibrary.get(library.id).push(sample)
      }
    }

    for (const library of libraries) {
      const samples = samplesByLibrary.get(library.id)
      results.push({
        library: library.name,
        scenario: scenario.id,
        ...(memoryScaling ? { rows: rowCount } : {}),
        median: summarize(samples),
        samples,
      })
    }
  }
}

const scaling = memoryScaling
  ? libraries.map((library) => {
      const measurements = results.filter((result) => result.library === library.name)
      const smallest = measurements[0].median
      const largest = measurements.at(-1).median
      return {
        library: library.name,
        inputGrowth: round(largest.inputBytes / smallest.inputBytes),
        heapGrowth: round(largest.heapDeltaMiB / smallest.heapDeltaMiB),
        rssGrowth: round(largest.rssDeltaMiB / smallest.rssDeltaMiB),
      }
    })
  : null

const report = {
  config: {
    ...config,
    scenarios,
  },
  environment: {
    arch: process.arch,
    cpu: cpus()[0]?.model,
    node: process.version,
    platform: process.platform,
  },
  libraries: libraries.map((library) => ({ name: library.name, version: library.version })),
  results,
  ...(scaling ? { scaling } : {}),
}

await writeFile(baselinePath, JSON.stringify(report, null, 2))

console.table(
  results.map(({ library, median: value, rows, scenario }) => {
    const tableRow = {
      library,
      scenario,
      'elapsed ms': value.elapsedMs,
      'MiB/s': value.inputMiBPerSecond,
      'first byte ms': value.firstByteMs,
      'heap delta MiB': value.heapDeltaMiB,
      'RSS delta MiB': value.rssDeltaMiB,
    }
    if (memoryScaling) tableRow.rows = rows
    return tableRow
  }),
)
if (scaling) console.table(scaling)
console.log(`\nWrote ${baselinePath}`)