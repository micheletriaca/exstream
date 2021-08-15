const _ = require('../src/index.js')
const h = require('./helpers.js')
const EventEmitter = require('events').EventEmitter
const __ = require('highland')
const zlib = require('zlib')
jest.mock('fs')
const fs = require('fs')

const out = [...h.randomStringGenerator(10000)].map(x => x.toString() + '\n')

beforeEach(() => {
  fs.__setMockFiles({ out })
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
    const z = x.consume((err, x, push, next) => {
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
    z.resume()
  })
})

test('test write', () => {
  const x = _()
  const y = []
  return new Promise((resolve) => {
    const z = x.consume((err, x, push, next) => {
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
    z.resume()
    x.write(1)
    x.write(2)
    x.write(3)
    x.write(4)
    x.write(_.nil)
    let exception = false
    try {
      x.write(5)
    } catch (e) {
      exception = true
    }
    expect(exception).toBe(true)
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

test('uniq', () => {
  _([1, 2, 2, 2, 5]).uniq().toArray(res => {
    expect(res).toEqual([1, 2, 5])
  })
})

test('uniqBy', () => {
  _([
    { a: 1, b: 1, c: 1 },
    { a: 1, b: 2, c: 2 },
    { a: 1, b: 3, c: 1 }
  ]).uniqBy(['a', 'c']).toArray(res => {
    expect(res).toEqual([{ a: 1, b: 1, c: 1 }, { a: 1, b: 2, c: 2 }])
  })

  _([
    { a: 1, b: 1, c: 1 },
    { a: 1, b: 2, c: 2 },
    { a: 1, b: 3, c: 1 }
  ]).uniqBy('c').toArray(res => {
    expect(res).toEqual([{ a: 1, b: 1, c: 1 }, { a: 1, b: 2, c: 2 }])
  })

  _([1, 2, 3, 4]).uniqBy(x => x % 2 === 0).toArray(res => expect(res).toEqual([1, 2]))
})

test('flatten', () => {
  _([[1, [2, 3]], [4, [5]]])
    .flatten()
    .toArray(res => {
      expect(res).toEqual([1, [2, 3], 4, [5]])
      _(res).flatten().toArray(res2 => {
        expect(res2).toEqual([1, 2, 3, 4, 5])
      })
    })

  _([1, 2, 3, 4, 5])
    .batch(3)
    .flatten()
    .toArray(res => {
      expect(res).toEqual([1, 2, 3, 4, 5])
    })

  _([1, 2, 3, 4, 5])
    .flatten()
    .toArray(res => {
      expect(res).toEqual([1, 2, 3, 4, 5])
    })
})

test('flatten iterable', () => {
  _([1, 2, 3, 4, 5])
    .batch(3)
    .map(x => new Set(x))
    .flatten()
    .toArray(res => {
      expect(res).toEqual([1, 2, 3, 4, 5])
    })
})

test('piping', () => new Promise(resolve => {
  const res = []
  _([1, 2, 3])
    .map(x => x * 2)
    .map(x => x.toString())
    .pipe(_().map(x => x + x))
    .pipe(_.pipeline().map(x => x + x))
    .pipe(h.getSlowWritable(res))
    .on('finish', () => {
      resolve()
      expect(res).toEqual(['2222', '4444', '6666'])
    })
}))

test('extend', () => {
  _.extend('duplicate', function () { return this.map(x => x * 2) })
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

test('async filter', async () => {
  const res = await _([1, 2, 3])
    .filter(async x => {
      await h.sleep(100)
      return x % 2 === 0
    })
    .toPromise()

  expect(res).toEqual([2])
})

test('reduce', () => {
  _([1, 2, 3])
    .reduce(0, (memo, x) => memo + x)
    .toArray(res => {
      expect(res).toEqual([6])
    })
})

test('async reduce', async () => {
  const res = await _([1, 2, 3])
    .reduce(0, async (memo, x) => {
      await h.sleep(10)
      return memo + x
    })
    .toPromise()
  expect(res).toEqual([6])
})

test('through pipeline', () => {
  _([1, 2, 3])
    .through(_.pipeline()
      .map(x => x * 2)
      .map(x => x * 2)
    )
    .toArray(res => {
      expect(res).toEqual([4, 8, 12])
    })
})

test('through stream', () => {
  _([1, 2, 3])
    .through(_()
      .map(x => x * 2)
      .map(x => x * 2)
    )
    .toArray(res => {
      expect(res).toEqual([4, 8, 12])
    })

  let exception = false
  try {
    _([1, 2, 3]).through(2)
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
})

test('toPromise', async () => {
  const res = await _([1, 2, 3])
    .map(x => x * 2)
    .toPromise()

  expect(res).toEqual([2, 4, 6])
})

test('unordered promises', async () => {
  let sleepCount = 3
  const sleep = x => new Promise(resolve => setTimeout(() => resolve(x), 200 * sleepCount--))

  const res = await _([2, 3, 4])
    .map(x => sleep(x))
    .then(x => x * 2)
    .then(x => x * 2)
    .resolve(2, false)
    .toPromise()

  expect(res).toEqual([12, 8, 16])
})

test('ordered promises', async () => {
  let sleepCount = 3
  const decrementalSlowMap = x => new Promise(resolve => setTimeout(() => resolve(x), 200 * sleepCount--))

  const res = await _([2, 3, 4])
    .map(x => decrementalSlowMap(x))
    .then(x => x * 2)
    .then(x => x * 2)
    .resolve(3)
    .toPromise()

  expect(res).toEqual([8, 12, 16])
})

test('slow writes on node stream', () => {
  const res = []
  return new Promise(resolve => {
    _([2, 3, 4])
      .map(x => x * 2)
      .pipe(h.getSlowWritable(res))
      .on('finish', () => {
        resolve()
        expect(res).toEqual([4, 6, 8])
      })
  })
})

test('promise in constructor', () => {
  const p = async () => {
    await h.sleep(10)
    return 'x'
  }

  return new Promise(resolve => {
    _(p()).toArray(res => {
      expect(res).toEqual(['x'])
      resolve()
    })
  })
})

test('generator', () => {
  return new Promise(resolve => {
    _(h.fibonacci(10))
      .pipe(h.getSlowWritable())
      .on('finish', resolve)
  })
})

test('generator end event', () => {
  return new Promise(resolve => {
    _(h.fibonacci(10))
      .on('end', resolve)
      .map(x => x.toString())
      .pipe(process.stdout)
  })
})

const asyncIterator = async function * (iterations = 10) {
  for (let i = 0; i < iterations; i++) {
    await h.sleep(0)
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
      h.sleep(0).then(() => {
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
      h.sleep(0).then(() => {
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

test('forking', async () => {
  const s = _([1, 2, 3])
  const p1 = s.fork().map(x => x * 2 + 1).toPromise()
  const p2 = s.fork().map(x => x * 2 + 2).toPromise()
  const p3 = s.fork().map(x => x * 2 + 3).toPromise()
  s.start()
  const [r1, r2, r3] = await Promise.all([p1, p2, p3])
  expect(r1).toEqual([3, 5, 7])
  expect(r2).toEqual([4, 6, 8])
  expect(r3).toEqual([5, 7, 9])
})

test('fork and back pressure', async () => new Promise(resolve => {
  const res = []
  const stream = _([1, 2, 3, 4, 5]).map(String)
  const l = stream.fork()
  const r = stream.fork()
  r.take(2).pipe(h.getSlowWritable(res, 0))
  l.on('end', () => {
    resolve()
    expect(res).toEqual(['1', '1', '2', '2', '3', '4', '5'])
  }).pipe(h.getSlowWritable(res, 0))
  setImmediate(() => stream.start())
}))

test('merging', async () => new Promise((resolve) => {
  const res = []
  const s = _([1, 2, 3])
  _([
    s.fork().map(x => x * 2 + 1),
    s.fork().map(x => x * 2 + 2),
    s.fork().map(x => x * 2 + 3)
  ]).merge(3)
    .pipe(h.getSlowWritable(res))
    .on('finish', () => {
      expect(res).toEqual([3, 4, 5, 5, 6, 7, 7, 8, 9])
      resolve()
    })
  s.start()
}))

test('merging2', async () => new Promise((resolve) => {
  _([
    _(fs.createReadStream('out')),
    _(fs.createReadStream('out'))
  ]).merge()
    .pipe(fs.createWriteStream('out3'))
    .on('finish', resolve)
}))

test('merging3', async () => {
  let excep = false
  await _([1, 2])
    .merge()
    .toPromise()
    .catch(e => {
      excep = true
    })
  expect(excep).toBe(true)
})

test('multithread', async () => new Promise((resolve) => {
  _(h.randomStringGenerator(100000))
    .multi(3, 10000, _.pipeline()
      .map(x => x.toUpperCase())
      .map(x => x + '\n')
    )
    .merge()
    .pipe(fs.createWriteStream('rand'))
    .on('finish', resolve)
}))

test('pipe pipeline', async () => new Promise((resolve) => {
  const p = _.pipeline()
    .map(x => x.toString())
    .collect()
    .map(x => x.join().split('\n'))
    .flatten()
    .map(x => 'buahaha' + x + '\n')

  const res = []
  fs.createReadStream('out').pipe(p.generateStream()).pipe(h.getSlowWritable(res, 0)).on('finish', () => {
    resolve()
    expect(res.length).toBe(10001)
  })
}))

test('pipeToFile', () => {
  return new Promise(resolve => {
    _(h.fibonacci(10000))
      .map(x => x.toString() + '\n')
      .pipe(fs.createWriteStream('fibo'))
      .on('finish', resolve)
  })
})

test('not more than 1 consumer if not fork', () => {
  const s = _()
  s.map(x => x)
  let exception = false
  try {
    s.map(x => x * 2)
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
  s.fork().map(x => x)
})

test('csv', () => {
  _([Buffer.from('a,b,c\n1,2,3\n"ciao ""amico""","multiline\nrow",3\n')])
    .csv({ header: true })
    .toArray(res => {
      expect(res).toEqual([
        { a: '1', b: '2', c: '3' },
        { a: 'ciao "amico"', b: 'multiline\nrow', c: '3' }
      ])
    })

  _([Buffer.from('a,b,c\n1,2,3\n"ciao "'), Buffer.from('"amico""","multiline\nrow",3\n')])
    .csv({ header: ['aa', 'bb', 'cc'] })
    .toArray(res => {
      expect(res).toEqual([
        { aa: 'a', bb: 'b', cc: 'c' },
        { aa: '1', bb: '2', cc: '3' },
        { aa: 'ciao "amico"', bb: 'multiline\nrow', cc: '3' }
      ])
    })

  _([Buffer.from('a,b,c\n1,2,3\n"ciao ""amico""","multiline\nrow",3\n')])
    .csv({ header: row => row.map(x => x + x) })
    .toArray(res => {
      expect(res).toEqual([
        { aa: '1', bb: '2', cc: '3' },
        { aa: 'ciao "amico"', bb: 'multiline\nrow', cc: '3' }
      ])
    })

  _([Buffer.from('a,b,c\r1,2,3\r\n"ciao ""amico""","multiline\nrow",3\n')])
    .csv({ header: false })
    .toArray(res => {
      expect(res).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
        ['ciao "amico"', 'multiline\nrow', '3']
      ])
    })
})