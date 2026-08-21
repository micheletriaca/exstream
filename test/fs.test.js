const _ = require('../src/index.js')
const h = require('./helpers.js')
const zlib = require('zlib')
const fs = require('./__mocks__/fs.js')
vi.setConfig({ testTimeout: 2000 })

const out = [...h.randomStringGenerator(10000)].map((x) => x.toString() + '\n')

beforeEach(() => {
  fs.__setMockFiles({ out })
})

test('merging with fs', async () => {
  await _([_(fs.createReadStream('out')), _(fs.createReadStream('out'))])
    .merge({ concurrency: 1 })
    .pipeTo(fs.createWriteStream('out3'))
  const o = out.map((x) => x.toString()).join('')
  expect(fs.__getMockFiles().out3.join('')).toEqual(o + o)
})

test('through node stream', async () => {
  await _(fs.createReadStream('out'))
    .through(zlib.createGzip())
    .pipeTo(fs.createWriteStream('out.gz'))
  await _(fs.createReadStream('out.gz'))
    .through(zlib.createGunzip())
    .pipeTo(fs.createWriteStream('out2'))
  expect(fs.readFileSync('out')).toEqual(fs.readFileSync('out2'))
})

test('pipe pipeline', async () => {
  const p = _.pipeline()
    .map((x) => x.toString())
    .take(10)
    .collect()
    .map((x) => x.join().split('\n'))
    .flatten()
    .map((x) => 'buahaha' + x + '\n')

  const res = []
  await _(fs.createReadStream('out')).through(p).pipeTo(h.getSlowWritable(res, 0))

  expect(res.length).toBe(11)
})

test('pipeToFile', async () => {
  await _(h.fibonacci(5))
    .map((x) => x.toString() + '\n')
    .pipeTo(fs.createWriteStream('fibo'))
  expect(fs.__getMockFiles().fibo.join('')).toBe('0\n1\n1\n2\n3\n')
})