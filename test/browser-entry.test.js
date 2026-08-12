const { execFileSync } = require('node:child_process')
const path = require('node:path')

test('browser entry runs without contaminating the Node runtime', () => {
  const harness = path.resolve(__dirname, 'browser/entry-harness.cjs')
  const output = execFileSync(process.execPath, [harness], { encoding: 'utf8' })

  expect(output.trim()).toBe('EXSTREAM_BROWSER_ENTRY_PASS checks=6')
})