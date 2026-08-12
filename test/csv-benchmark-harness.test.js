const { execFile } = require('node:child_process')
const path = require('node:path')

vi.setConfig({ testTimeout: 30_000 })

test('CSV benchmark smoke preset produces a self-describing report', async () => {
  const script = path.resolve(__dirname, 'benchmarks/streaming-csv.mjs')
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, '--preset=smoke', '--library=exstream', '--no-write', '--json'],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (error, output) => {
        if (error) reject(error)
        else resolve(output)
      },
    )
  })
  const report = JSON.parse(stdout)

  expect(report.schemaVersion).toBe(1)
  expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false)
  expect(report.source).toMatchObject({
    files: expect.arrayContaining(['src/csv-parser.js', 'test/benchmarks/streaming-csv.mjs']),
    sha256: expect.stringMatching(/^[a-f\d]{64}$/),
  })
  expect(report.command).toContain('--preset=smoke')
  expect(report.environment).toMatchObject({
    arch: process.arch,
    node: process.version,
    platform: process.platform,
  })
  expect(report.libraries).toEqual([{ name: 'Exstream', version: expect.any(String) }])
  expect(report.config.scenarios).toHaveLength(3)
  expect(report.config.datasetGeneration).toMatchObject({
    description: expect.any(String),
    maximumSampleRows: expect.any(Object),
  })
  expect(report.results).toHaveLength(3)
  for (const result of report.results) {
    expect(result.median).toMatchObject({
      elapsedMs: expect.any(Number),
      firstOutputMs: expect.any(Number),
      heapDeltaMiB: expect.any(Number),
      heapPeakMiB: expect.any(Number),
      recordsPerSecond: expect.any(Number),
      rssDeltaMiB: expect.any(Number),
      rssPeakMiB: expect.any(Number),
    })
  }
  expect(report.allocationMetrics).toMatchObject({
    exactBytes: null,
    exactCount: null,
    reason: expect.any(String),
  })
})

test('CSV benchmark only runs libraries in scenarios supported by their streaming APIs', async () => {
  const script = path.resolve(__dirname, 'benchmarks/streaming-csv.mjs')
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, '--preset=smoke', '--no-write', '--json'],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (error, output) => {
        if (error) reject(error)
        else resolve(output)
      },
    )
  })
  const report = JSON.parse(stdout)
  const librariesByCase = Object.groupBy(report.results, (result) => result.case)

  expect(report.libraries.map(({ name }) => name)).toEqual([
    'Exstream',
    'Node CSV',
    'Fast-CSV',
    'CSV Parser',
    'Papa Parse',
  ])
  expect(report.libraryCapabilities).toEqual(
    expect.arrayContaining([
      {
        id: 'csv-parser',
        modes: ['object'],
        name: 'CSV Parser',
        operations: ['parse'],
      },
      {
        id: 'papaparse',
        modes: ['array', 'object'],
        name: 'Papa Parse',
        operations: ['parse'],
      },
    ]),
  )
  expect(librariesByCase['parse-plain-object'].map(({ library }) => library)).toEqual([
    'Exstream',
    'Node CSV',
    'Fast-CSV',
    'CSV Parser',
    'Papa Parse',
  ])
  expect(librariesByCase['stringify-quoted-array'].map(({ library }) => library)).toEqual([
    'Exstream',
    'Node CSV',
    'Fast-CSV',
  ])
  expect(librariesByCase['pipeline-slow-object'].map(({ library }) => library)).toEqual([
    'Exstream',
    'Node CSV',
    'Fast-CSV',
  ])
  for (const result of report.results) {
    expect(result.samples[0].processedRecords).toBe(1_000)
  }
})