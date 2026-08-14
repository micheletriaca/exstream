import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { cpus, release, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { presetDefaults, presets } from './csv-benchmark-cases.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const workerPath = join(root, 'test/benchmarks/streaming-csv.worker.mjs')
const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const sourceFiles = [
  'package-lock.json',
  'package.json',
  'src/csv-parser.js',
  'src/csv.js',
  'src/node-runtime.js',
  'src/runtime.js',
  'src/web-codecs.js',
  'test/benchmarks/csv-benchmark-cases.mjs',
  'test/benchmarks/csv-benchmark-data.mjs',
  'test/benchmarks/streaming-csv.mjs',
  'test/benchmarks/streaming-csv.worker.mjs',
]
const sourceHash = createHash('sha256')
const sourceContents = await Promise.all(sourceFiles.map((file) => readFile(join(root, file))))
for (let index = 0; index < sourceFiles.length; index++) {
  const file = sourceFiles[index]
  sourceHash.update(file)
  sourceHash.update('\0')
  sourceHash.update(sourceContents[index])
  sourceHash.update('\0')
}

const readArgument = (name, fallback = null) => {
  const prefix = `--${name}=`
  const argument = process.argv.find((value) => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length) : fallback
}

const preset = readArgument(
  'preset',
  process.argv.includes('--memory-scaling') ? 'memory' : 'quick',
)
if (!presets[preset]) throw Error(`unknown CSV benchmark preset: ${preset}`)
const outputArgument = readArgument('output')
const outputPath = outputArgument
  ? join(root, outputArgument)
  : join(root, `test/benchmarks/csv-benchmark-${preset}.json`)
const noWrite = process.argv.includes('--no-write')
const jsonOnly = process.argv.includes('--json')
const caseFilter = readArgument('case')
const libraryFilter = readArgument('library')
const runsArgument = readArgument('runs')
const warmupsArgument = readArgument('warmups')
const defaults = presetDefaults[preset]
const measuredRuns = runsArgument === null ? defaults.measuredRuns : Number(runsArgument)
const warmupRuns = warmupsArgument === null ? defaults.warmupRuns : Number(warmupsArgument)

if (![measuredRuns, warmupRuns].every(Number.isInteger) || measuredRuns <= 0 || warmupRuns < 0) {
  throw Error('CSV benchmark runs must be positive and warmups must be non-negative integers')
}

const allLibraries = [
  {
    id: 'exstream',
    modes: ['array', 'object'],
    name: 'Exstream',
    operations: ['parse', 'pipeline', 'stringify'],
    version: packageJson.version,
  },
  {
    id: 'node-csv',
    modes: ['array', 'object'],
    name: 'Node CSV',
    operations: ['parse', 'pipeline', 'stringify'],
    version:
      `${packageLock.packages['node_modules/csv-parse'].version} / ` +
      packageLock.packages['node_modules/csv-stringify'].version,
  },
  {
    id: 'fast-csv',
    modes: ['array', 'object'],
    name: 'Fast-CSV',
    operations: ['parse', 'pipeline', 'stringify'],
    version: packageLock.packages['node_modules/fast-csv'].version,
  },
  {
    id: 'csv-parser',
    modes: ['object'],
    name: 'CSV Parser',
    operations: ['parse'],
    version: packageLock.packages['node_modules/csv-parser'].version,
  },
  {
    id: 'papaparse',
    modes: ['array', 'object'],
    name: 'Papa Parse',
    operations: ['parse'],
    version: packageLock.packages['node_modules/papaparse'].version,
  },
]
const libraries = allLibraries.filter((library) => !libraryFilter || library.id === libraryFilter)
const scenarios = presets[preset].filter((scenario) => !caseFilter || scenario.id === caseFilter)
if (libraries.length === 0) throw Error(`unknown CSV benchmark library: ${libraryFilter}`)
if (scenarios.length === 0) throw Error(`unknown CSV benchmark case: ${caseFilter}`)
const supports = (library, scenario) =>
  library.modes.includes(scenario.mode) && library.operations.includes(scenario.operation)
const scenarioPlans = scenarios
  .map((scenario) => ({
    libraries: libraries.filter((library) => supports(library, scenario)),
    scenario,
  }))
  .filter(({ libraries: scenarioLibraries }) => scenarioLibraries.length > 0)
if (scenarioPlans.length === 0) {
  throw Error(`CSV benchmark library and case filters select no compatible scenarios`)
}
const activeLibraries = libraries.filter((library) =>
  scenarioPlans.some(({ libraries: scenarioLibraries }) => scenarioLibraries.includes(library)),
)

const round = (value, digits = 2) =>
  value === null || value === void 0 ? null : Number(value.toFixed(digits))
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

const toMiB = (bytes) => round(bytes / 1024 / 1024)

const enrich = (sample) => ({
  ...sample,
  allocationBytes: null,
  allocationCount: null,
  arrayBuffersDeltaMiB: toMiB(sample.arrayBuffersDeltaBytes),
  elapsedMs: round(sample.elapsedMs),
  externalDeltaMiB: toMiB(sample.externalDeltaBytes),
  firstOutputMs: round(sample.firstOutputMs),
  firstRecordMs: round(sample.firstRecordMs),
  gcDurationMs: round(sample.gcDurationMs),
  heapDeltaMiB: toMiB(sample.heapDeltaBytes),
  heapPeakMiB: toMiB(sample.heapPeakBytes),
  heapStartMiB: toMiB(sample.heapStartBytes),
  inputMiBPerSecond: round(sample.inputBytes / 1024 / 1024 / (sample.elapsedMs / 1000)),
  outputMiBPerSecond:
    sample.outputBytes === 0
      ? null
      : round(sample.outputBytes / 1024 / 1024 / (sample.elapsedMs / 1000)),
  recordsPerSecond: round(sample.processedRecords / (sample.elapsedMs / 1000)),
  rssDeltaMiB: toMiB(sample.rssDeltaBytes),
  rssPeakMiB: toMiB(sample.rssPeakBytes),
  rssStartMiB: toMiB(sample.rssStartBytes),
  datasetSetupMs: round(sample.datasetSetupMs),
  librarySetupMs: round(sample.librarySetupMs),
})

const summaryMetrics = [
  'elapsedMs',
  'firstRecordMs',
  'firstOutputMs',
  'inputMiBPerSecond',
  'outputMiBPerSecond',
  'recordsPerSecond',
  'heapDeltaMiB',
  'heapPeakMiB',
  'heapStartMiB',
  'rssDeltaMiB',
  'rssPeakMiB',
  'rssStartMiB',
  'externalDeltaMiB',
  'arrayBuffersDeltaMiB',
  'gcCount',
  'gcDurationMs',
  'datasetSetupMs',
  'librarySetupMs',
]

const summarize = (samples) =>
  Object.fromEntries(
    summaryMetrics.map((metric) => {
      const values = samples.map((sample) => sample[metric]).filter((value) => value !== null)
      return [metric, values.length === 0 ? null : round(median(values))]
    }),
  )

const runWorker = async (library, scenario) => {
  const child = spawn(
    process.execPath,
    [
      '--expose-gc',
      workerPath,
      JSON.stringify({
        library: library.id,
        memorySampleMs: defaults.memorySampleMs,
        scenario,
      }),
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
  return enrich(JSON.parse(stdout))
}

const results = []
for (const { libraries: scenarioLibraries, scenario } of scenarioPlans) {
  const samplesByLibrary = new Map(scenarioLibraries.map((library) => [library.id, []]))
  if (!jsonOnly) {
    process.stderr.write(
      `\n${scenario.id}: ${scenario.description} (${scenario.rows.toLocaleString('en-US')} rows)\n`,
    )
  }
  for (let roundIndex = 0; roundIndex < warmupRuns + measuredRuns; roundIndex++) {
    const rotated = scenarioLibraries.map(
      (_, index) => scenarioLibraries[(index + roundIndex) % scenarioLibraries.length],
    )
    for (const library of rotated) {
      // Sequential fresh processes avoid CPU, heap, and module-cache cross-contamination.
      const sample = await runWorker(library, scenario)
      const warmup = roundIndex < warmupRuns
      if (!jsonOnly) {
        process.stderr.write(
          `${warmup ? 'warmup' : `run ${roundIndex - warmupRuns + 1}`}: ${library.name} ` +
            `${sample.elapsedMs} ms, ${sample.recordsPerSecond} records/s, ` +
            `${sample.inputMiBPerSecond} input MiB/s, ${sample.rssDeltaMiB} MiB RSS\n`,
        )
      }
      if (!warmup) samplesByLibrary.get(library.id).push(sample)
    }
  }
  for (const library of scenarioLibraries) {
    const samples = samplesByLibrary.get(library.id)
    results.push({
      case: scenario.id,
      library: library.name,
      median: summarize(samples),
      samples,
    })
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: { files: sourceFiles, sha256: sourceHash.digest('hex') },
  allocationMetrics: {
    exactBytes: null,
    exactCount: null,
    reason: 'Node.js exposes no stable public API for exact per-pipeline allocation counts.',
    substitutes: [
      'sampled peak heapUsed',
      'sampled peak RSS',
      'sampled peak external memory',
      'sampled peak ArrayBuffer memory',
      'GC count and duration',
    ],
  },
  command: `node test/benchmarks/streaming-csv.mjs ${process.argv.slice(2).join(' ')}`.trim(),
  config: {
    datasetGeneration: {
      description:
        'CSV input is prepared before measurement; serializer sources repeat a bounded pool of deterministic rows.',
      maximumSampleRows: { large: 4, narrow: 1024, plain: 1024, quoted: 1024, wide: 256 },
    },
    measuredRuns,
    memorySampleMs: defaults.memorySampleMs,
    preset,
    scenarios: scenarioPlans.map(({ scenario }) => scenario),
    warmupRuns,
  },
  environment: {
    arch: process.arch,
    cpu: cpus()[0]?.model,
    cpuCount: cpus().length,
    memoryGiB: round(totalmem() / 1024 / 1024 / 1024),
    node: process.version,
    osRelease: release(),
    platform: process.platform,
  },
  libraries: activeLibraries.map(({ name, version }) => ({ name, version })),
  libraryCapabilities: activeLibraries.map(({ id, modes, name, operations }) => ({
    id,
    modes,
    name,
    operations,
  })),
  results,
}

if (!noWrite) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
if (jsonOnly) {
  process.stdout.write(JSON.stringify(report))
} else {
  console.table(
    results.map((result) => ({
      case: result.case,
      'elapsed ms': result.median.elapsedMs,
      'first record ms': result.median.firstRecordMs,
      'input MiB/s': result.median.inputMiBPerSecond,
      library: result.library,
      'records/s': result.median.recordsPerSecond,
      'RSS MiB': result.median.rssDeltaMiB,
    })),
  )
  console.log(noWrite ? '\nReport not written (--no-write)' : `\nWrote ${outputPath}`)
}