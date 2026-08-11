import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { cpus } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const baselinePath = join(root, 'test/benchmarks/baseline.json')
const vitestPath = join(root, 'node_modules/vitest/vitest.mjs')
const child = spawn(
  process.execPath,
  [
    vitestPath,
    'bench',
    '--run',
    'test/benchmarks/performance-baseline.bench.mjs',
    '--outputJson',
    baselinePath,
  ],
  { cwd: root, stdio: 'inherit' },
)
const [exitCode] = await once(child, 'close')

if (exitCode !== 0) {
  process.exitCode = exitCode
} else {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
  baseline.environment = {
    arch: process.arch,
    cpu: cpus()[0]?.model,
    node: process.version,
    platform: process.platform,
  }
  for (const file of baseline.files) file.filepath = relative(root, file.filepath)
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2))
}