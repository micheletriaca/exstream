jest.setTimeout(2000)

const _ = require('../src/index.js')
const h = require('./helpers.js')
const zlib = require('zlib')
jest.mock('fs')
const fs = require('fs')

const out = [...h.randomStringGenerator(10000)].map(x => x.toString() + '\n')

beforeEach(() => {
  fs.__setMockFiles({ out })
})

test('merging with fs', async () => new Promise(resolve => {
  _([
    _(fs.createReadStream('out')),
    _(fs.createReadStream('out')),
  ]).merge(1)
    .pipe(fs.createWriteStream('out3'))
    .on('finish', () => {
      resolve()
      const o = out.map(x => x.toString()).join('')
      expect(fs.__getMockFiles().out3.join('')).toEqual(o + o)
    })
}))

test('through node stream', () => new Promise(resolve => {
  _(fs.createReadStream('out'))
    .through(zlib.createGzip())
    .pipe(fs.createWriteStream('out.gz'))
    .on('finish', () => {
      _(fs.createReadStream('out.gz'))
        .through(zlib.createGunzip())
        .pipe(fs.createWriteStream('out2'))
        .on('finish', () => {
          const f1 = fs.readFileSync('out')
          const f2 = fs.readFileSync('out2')
          expect(f1).toEqual(f2)
          resolve()
        })
    })
}))

test('pipe pipeline', done => {
  const p = _.pipeline()
    .map(x => x.toString())
    .take(10)
    .collect()
    .map(x => x.join().split('\n'))
    .flatten()
    .map(x => 'buahaha' + x + '\n')

  const res = []
  fs.createReadStream('out')
    .pipe(p.generateStream())
    .pipe(h.getSlowWritable(res, 0))
    .on('finish', () => {
      done()
      expect(res.length).toBe(11)
    })
})
