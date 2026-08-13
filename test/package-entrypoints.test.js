const { EventEmitter } = require('node:events')
const { execFileSync } = require('node:child_process')

test('the explicit Node package entry preserves EventEmitter compatibility', () => {
  const node = require('exstream.js/node')

  expect(node([1])).toBeInstanceOf(EventEmitter)
})

test('CommonJS and ESM load the same Node export', async () => {
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { createRequire } from 'node:module'
       const require = createRequire(import.meta.url)
       const commonJs = require('exstream.js/node')
       const esm = await import('exstream.js/node')
       process.stdout.write(String(
         esm.default === commonJs &&
         esm.nil === commonJs.nil &&
         esm.map === commonJs.map
       ))`,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  )

  expect(result).toBe('true')
})