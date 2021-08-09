const _ = require('./exstream.js')
const EventEmitter = require('events').EventEmitter
const { Writable } = require('stream')
const __ = require('highland')
const zlib = require('zlib')

const sleep = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms))

const getSlowWritable = () => new Writable({
  objectMode: true,
  highWaterMark: 0,
  write (rec, encoding, callback) {
    sleep().then(callback)
  }
})

test('stream initialization', () => {
  const x = _([1, 2, 3])
  const y = _([1, 2, 3])
  const z = _(x)
  expect(x === y).toBe(false)
  expect(x === z).toBe(true)
})

test('stream is event emitter', () => {
  const x = _([1, 2, 3])
  expect(x).toBeInstanceOf(EventEmitter)
})

test('consume stream', () => {
  const x = _([1, 2, 3])
  const y = []
  x.consume((err, x, push, next) => {
    if (err) {
      y.push(err)
      next()
    } else if (x !== _.nil) {
      y.push(x)
      next()
    } else {
      push(null, _.nil)
    }
  }).on('end', () => {
    expect(y).toEqual([1, 2, 3])
  })
  x.resume()
})

test('backpressure', () => {
  const x = _([1, 2, 3])
  const y = []
  return new Promise((resolve) => {
    x.consume((err, x, push, next) => {
      if (err) {
        y.push(err)
        setTimeout(() => next(), 100)
      } else if (x !== _.nil) {
        y.push(x)
        setTimeout(() => next(), 100)
      } else {
        push(null, _.nil)
      }
    }).on('end', () => {
      expect(y).toEqual([1, 2, 3])
      resolve()
    })
    x.resume()
  })
})

test('test write', () => {
  const x = _()
  const y = []
  return new Promise((resolve) => {
    x.consume((err, x, push, next) => {
      if (err) {
        y.push(err)
        next()
      } else if (x !== _.nil) {
        y.push(x)
        next()
      } else {
        push(null, _.nil)
      }
    }).on('end', () => {
      expect(y).toEqual([1, 2, 3, 4])
      resolve()
    })
    x.resume()
    x.write(1)
    x.write(2)
    x.write(3)
    x.write(4)
    x.write(_.nil)
  })
})

test('toArray', () => {
  _([1, 2, 3]).toArray(res => {
    expect(res).toEqual([1, 2, 3])
  })
})

test('collect', () => {
  _([1, 2, 3]).collect().toArray(res => {
    expect(res).toEqual([[1, 2, 3]])
  })
})

test('each', () => {
  let i = 1
  _([1, 2, 3]).each(x => expect(x).toBe(i++))
})

const largeArray = n => {
  const res = []
  for (let i = 0; i < n; i++) {
    res.push(n)
  }
  return res
}
const k = largeArray(100000)
const k2 = k.map(x => x * 2)

test('map hl', () => {
  __(k).map(x => x * 2).toArray(res => {
    expect(res).toEqual(k2)
  })
})

test('map', () => {
  _(k).map(x => x * 2).toArray(res => {
    expect(res).toEqual(k2)
  })
})

test('plain map', () => {
  const k3 = k.map(x => x * 2)
  expect(k3).toEqual(k2)
})

test('old plain map', () => {
  const k3 = []
  for (let i = 0, len = k.length; i < len; i++) {
    k3.push(k[i] * 2)
  }
  expect(k3).toEqual(k2)
})

test('map object', () => {
  _({ a: 1, b: 2 }).map(x => x).toArray(res => {
    expect(res).toEqual([['a', 1], ['b', 2]])
  })
})

test('map set', () => {
  const x = new Set([1, 2, 3])
  _(x).map(x => x * 2).toArray(res => {
    expect(res).toEqual([2, 4, 6])
  })
})

test('batch', () => {
  _([1, 2, 3, 4, 5]).batch(3).toArray(res => {
    expect(res).toEqual([[1, 2, 3], [4, 5]])
  })
})

test('piping', () => new Promise(resolve => {
  _([1, 2, 3])
    .map(x => x * 2)
    .map(x => x.toString())
    .pipe(getSlowWritable())
    .on('finish', resolve)
}))

test('extend', () => {
  _.extend('duplicate', s => s.map(x => x * 2))
  _([1, 2, 3])
    .duplicate()
    .toArray(res => {
      expect(res).toEqual([2, 4, 6])
    })
})

test('filter', () => {
  _([1, 2, 3])
    .filter(x => x % 2 === 0)
    .toArray(res => {
      expect(res).toEqual([2])
    })
})

test('through', () => {
  _([1, 2, 3])
    .through(_().map(x => x * 2))
    .toArray(res => {
      expect(res).toEqual([2, 4, 6])
    })

  let exception = false
  try {
    _([1, 2, 3]).through(2)
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
})

test('toPromise', () => {
  return _([1, 2, 3])
    .map(x => x * 2)
    .toPromise()
    .then(res => {
      expect(res).toEqual([2, 4, 6])
    })
})

test('unordered promises', () => {
  let sleepCount = 3
  const sleep = x => new Promise(resolve => setTimeout(() => resolve(x), 200 * sleepCount--))

  return _([2, 3, 4])
    .map(x => sleep(x))
    .then(x => x * 2)
    .then(x => x * 2)
    .resolve(2, false)
    .toPromise()
    .then(res => {
      expect(res).toEqual([12, 8, 16])
    })
})

test('ordered promises', () => {
  let sleepCount = 3
  const decrementalSlowMap = x => new Promise(resolve => setTimeout(() => resolve(x), 200 * sleepCount--))

  return _([2, 3, 4])
    .map(x => decrementalSlowMap(x))
    .then(x => x * 2)
    .then(x => x * 2)
    .resolve(3)
    .toPromise()
    .then(res => {
      expect(res).toEqual([8, 12, 16])
    })
})

test('slow writes on node stream', () => {
  return new Promise(resolve => {
    _([2, 3, 4])
      .map(x => x * 2)
      .pipe(getSlowWritable())
      .on('finish', resolve)
  })
})

test('promise in constructor', () => {
  const p = async () => {
    await sleep(10)
    return 'x'
  }

  return new Promise(resolve => {
    _(p()).toArray(res => {
      expect(res).toEqual(['x'])
      resolve()
    })
  })
})

const fibonacci = function * (iterations) {
  let curr = 0; let next = 1
  for (let i = 0; i < iterations; i++) {
    yield curr
    ;[curr, next] = [next, curr + next]
  }
}

test('generator', () => {
  return new Promise(resolve => {
    _(fibonacci(10))
      .pipe(getSlowWritable())
      .on('finish', resolve)
  })
})

test('generator end event', () => {
  return new Promise(resolve => {
    _(fibonacci(10))
      .on('end', resolve)
      .map(x => x.toString())
      .pipe(process.stdout)
  })
})

const asyncIterator = async function * (iterations = 10) {
  for (let i = 0; i < iterations; i++) {
    await sleep(0)
    yield i
  }
}

test('async generator', () => {
  return new Promise(resolve => {
    _(asyncIterator(10))
      .toArray(res => {
        resolve()
        expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      })
  })
})

test('async generator no exstream', async () => {
  const res = []
  for await (const x of asyncIterator(10)) {
    res.push(x)
  }
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('async highland', () => {
  let i = -1
  return new Promise(resolve => __((push, next) => {
    i++
    if (i < 10) {
      sleep(0).then(() => {
        push(null, i)
        next()
      })
    } else push(null, __.nil)
  }).toArray(res => {
    resolve()
    expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  }))
})

test('async exstream', () => {
  let i = -1
  return new Promise(resolve => _((push, next) => {
    i++
    if (i < 10) {
      sleep(0).then(() => {
        push(null, i)
        next()
      })
    } else push(null, _.nil)
  }).toArray(res => {
    resolve()
    expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  }))
})

test('toNodeStream', () => {
  return new Promise(resolve => _([1, 2, 3])
    .map(x => x.toString())
    .toNodeStream()
    .on('end', resolve)
    .pipe(process.stdout)
  )
})

test('through node stream', () => {
  return new Promise(resolve => {
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
  })
})

const fs = require('fs')
test('pipeToFile', () => {
  return new Promise(resolve => {
    _(fibonacci(10000))
      .map(x => x.toString() + '\n')
      .pipe(fs.createWriteStream('out'))
      .on('finish', resolve)
  })
})
