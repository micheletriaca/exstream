const { EventEmitter } = require('node:events')
const { execFileSync } = require('node:child_process')

test('the explicit Node package entry preserves EventEmitter compatibility', () => {
  const node = require('exstream.js/node')

  expect(node([1])).toBeInstanceOf(EventEmitter)
})

test('the package surface excludes internal utilities and lifecycle controls', () => {
  const node = require('exstream.js/node')
  const stream = node()
  const internalUtilities = [
    'asNonNegativeFiniteNumber',
    'asPositiveInteger',
    'curry',
    'escapeRegExp',
    'get',
    'has',
    'isAsyncIterable',
    'isDefined',
    'isError',
    'isExstream',
    'isExstreamDestination',
    'isExstreamPipeline',
    'isFunction',
    'isIterable',
    'isNodeStream',
    'isPromise',
    'isString',
    'makeGetter',
    'ncurry',
    'partial',
    'splitFieldPath',
    'traverse',
  ]
  const lifecycleControls = ['abort', 'destroy', 'fail', 'pause', 'resume', 'writeData']

  expect(internalUtilities.filter((name) => name in node)).toEqual([])
  expect(lifecycleControls.filter((name) => name in stream)).toEqual([])
  expect(typeof stream.consume).toBe('function')
  expect(typeof stream.consumeSync).toBe('function')
  expect(typeof stream.start).toBe('function')
  expect(typeof stream.write).toBe('function')
  expect(typeof stream.end).toBe('function')
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
         esm.map === commonJs.map &&
         esm.json === commonJs.json &&
         esm.jsonl === commonJs.jsonl &&
         esm.jsonStringify === commonJs.jsonStringify &&
         esm.JsonParseError === commonJs.JsonParseError
       ))`,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  )

  expect(result).toBe('true')
})

test('published JSON named operators compose through CommonJS and ESM', () => {
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import exstream, { json, jsonl } from 'exstream.js/node'
       const selected = await exstream(['{"rows":[1,2]}']).through(json({ path: '$.rows[*]' })).toArray()
       const output = await exstream(['1\\n2\\n']).through(jsonl()).jsonStringify().toArray()
       process.stdout.write(JSON.stringify({ output, selected }))`,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  )

  expect(JSON.parse(result)).toEqual({ output: ['[1', ',2', ']'], selected: [1, 2] })
})