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