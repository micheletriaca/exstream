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
  const removedOperators = ['asyncFilter', 'asyncReduce', 'reduce1', 'sortBy']
  const instanceOnlyOperators = [
    'batch',
    'collect',
    'compact',
    'csv',
    'csvStringify',
    'decode',
    'drop',
    'encode',
    'errors',
    'extendContext',
    'failOnError',
    'filter',
    'find',
    'findWhere',
    'flatMap',
    'flatten',
    'groupBy',
    'head',
    'json',
    'jsonStringify',
    'jsonl',
    'jsonlStringify',
    'keyBy',
    'last',
    'makeAsync',
    'map',
    'mapAsync',
    'omit',
    'pick',
    'pluck',
    'ratelimit',
    'reduce',
    'reject',
    'routeErrors',
    'skipErrors',
    'slice',
    'sort',
    'sortedGroupBy',
    'sortedJoin',
    'split',
    'splitBy',
    'stopOnError',
    'stopWhen',
    'take',
    'tap',
    'throttle',
    'uniq',
    'uniqBy',
    'where',
    'withContext',
  ]

  expect(internalUtilities.filter((name) => name in node)).toEqual([])
  expect(lifecycleControls.filter((name) => name in stream)).toEqual([])
  expect(removedOperators.filter((name) => name in node)).toEqual([])
  expect(removedOperators.filter((name) => name in stream)).toEqual([])
  expect(removedOperators.filter((name) => name in node.pipeline())).toEqual([])
  expect(instanceOnlyOperators.filter((name) => name in node)).toEqual([])
  expect(typeof stream.consume).toBe('function')
  expect(typeof stream.consumeSync).toBe('function')
  expect(typeof stream.sortedJoin).toBe('function')
  expect(typeof node.defer).toBe('function')
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
         esm.pipeline === commonJs.pipeline &&
         esm.destination === commonJs.destination &&
         esm.fromEvent === commonJs.fromEvent &&
         esm.JsonParseError === commonJs.JsonParseError
       ))`,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  )

  expect(result).toBe('true')
})