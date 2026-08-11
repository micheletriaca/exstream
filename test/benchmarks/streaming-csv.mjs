import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const workerPath = join(root, 'test/benchmarks/streaming-csv.worker.mjs')
const baselinePath = join(root, 'test/benchmarks/streaming-csv-baseline.json')
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
const scenarios = [
  { id: 'fast-sink', throttleBytes: 0, throttleMs: 0 },
  { id: '32-mib-s-sink', throttleBytes: 64 * 1024, throttleMs: 2 },
]
const config = {
  chunkBytes: 64 * 1024,
  measuredRuns: 3,
  memorySampleMs: 10,
  rows: 500_000,
  warmupRuns: 1,
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits))
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function runWorker(library, scenario) {
  const child = spawn(
    process.execPath,
    [
      '--expose-gc',
      workerPath,
      library.id,
      String(config.rows),
      String(config.chunkBytes),
      String(scenario.throttleBytes),
      String(scenario.throttleMs),
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
for (const scenario of scenarios) {
  const samplesByLibrary = new Map(libraries.map((library) => [library.id, []]))
  process.stderr.write(`\n${scenario.id}\n`)

  for (let roundIndex = 0; roundIndex < config.warmupRuns + config.measuredRuns; roundIndex++) {
    const rotated = libraries.map((_, index) => libraries[(index + roundIndex) % libraries.length])
    for (const library of rotated) {
      // Sequential execution avoids CPU and memory contention between benchmark workers.
      // eslint-disable-next-line no-await-in-loop
      const sample = await runWorker(library, scenario)
      const warmup = roundIndex < config.warmupRuns
      process.stderr.write(
        `${warmup ? 'warmup' : `run ${roundIndex}`}: ${library.name} ` +
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
      median: summarize(samples),
      samples,
    })
  }
}

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
}

await writeFile(baselinePath, JSON.stringify(report, null, 2))

console.table(
  results.map(({ library, median: value, scenario }) => ({
    library,
    scenario,
    'elapsed ms': value.elapsedMs,
    'MiB/s': value.inputMiBPerSecond,
    'first byte ms': value.firstByteMs,
    'heap delta MiB': value.heapDeltaMiB,
    'RSS delta MiB': value.rssDeltaMiB,
  })),
)
console.log(`\nWrote ${baselinePath}`)