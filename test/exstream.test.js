/* eslint-disable max-lines */
const _ = require('../src/index.js')
const h = require('./helpers.js')
const EventEmitter = require('events').EventEmitter

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

test('write', () => {
  const x = _()
  const y = []
  return new Promise(resolve => {
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
    res.push(i)
  }
  return res
}
const k = largeArray(1000)
const k2 = k.map(x => x * 2)

test('map1', () => {
  _(k).map(x => x * 2).toArray(res => {
    expect(res).toEqual(k2)
  })
})

test('map wrap', () => {
  const res = _(k)
    .map(x => x * 2, { wrap: true })
    .values()

  expect(res.length).toEqual(k2.length)
  expect(res[345]).toEqual({ input: 345, output: 690 })
})

test('async map wrap', async () => {
  const res = await _(k)
    .map(async x => x * 2, { wrap: true })
    .resolve()
    .toPromise()

  expect(res.length).toEqual(k2.length)
  expect(res[345]).toEqual({ input: 345, output: 690 })
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

test('batch strange params', () => {
  _([1, 2, 3, 4, 5]).batch('3').toArray(res => {
    expect(res).toEqual([[1, 2, 3], [4, 5]])
  })
  let e = null
  try {
    _([1, 2, 3, 4, 5]).batch('nan')
  } catch (ex) {
    e = ex
  }
  expect(e).not.toBe(null)
  expect(e.message).toBe('error in .batch(). size must be a valid number')
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
    { a: 1, b: 3, c: 1 },
  ]).uniqBy(['a', 'c']).toArray(res => {
    expect(res).toEqual([{ a: 1, b: 1, c: 1 }, { a: 1, b: 2, c: 2 }])
  })

  _([
    { a: 1, b: 1, c: 1 },
    { a: 1, b: 2, c: 2 },
    { a: 1, b: 3, c: 1 },
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

test('flatMap', () => {
  const res = _([1, 2, 3])
    .flatMap(x => Array(x).fill(x))
    .values()
  expect(res).toEqual([1, 2, 2, 3, 3, 3])
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

test('synchronous tasks', () => {
  const res = _([1, 2, 3, 4, 5, 6])
    .map(x => x * 2)
    .batch(3)
    .values()
  expect(res).toEqual([[2, 4, 6], [8, 10, 12]])
})

test('synchronous reduce', () => {
  const res = _([1, 2, 3, 4, 5, 6])
    .reduce1((memo, x) => memo + x)
    .value()
  expect(res).toEqual(21)
})

test('async values', async () => {
  const res = await _([1, 2, 3, 4, 5, 6])
    .map(async x => x * 2)
    .resolve()
    .batch(3)
    .values()
  expect(res).toEqual([[2, 4, 6], [8, 10, 12]])
})

test('async value', async () => {
  const res = await _([1, 2, 3, 4, 5, 6])
    .map(async x => x * 2)
    .resolve()
    .reduce1((a, b) => a + b)
    .value()
  expect(res).toBe(42)
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
  _.extend('duplicate', function () {
    return this.map(x => x * 2)
  })
  _([1, 2, 3])
    .duplicate()
    .toArray(res => {
      expect(res).toEqual([2, 4, 6])
    })
})

test('filter', () => {
  const res = _([1, 2, 3])
    .filter(x => x % 2 === 0)
    .values()
  expect(res).toEqual([2])
})

test('reject', () => {
  const res = _([1, 2, 3])
    .reject(x => x % 2 === 0)
    .values()
  expect(res).toEqual([1, 3])
})

test('through pipeline', () => {
  _([1, 2, 3])
    .through(_.pipeline()
      .map(x => x * 2)
      .map(x => x * 2),
    )
    .toArray(res => {
      expect(res).toEqual([4, 8, 12])
    })
})

test('through accepts null', () => {
  const s = _([1, 2, 3])
  const s1 = s.through(null)
  expect(s).toBe(s1)
})

test('through _.function', async () => {
  const transform = _.map(x => x.toString(), null)

  const res = await _([1, 2, 3])
    .through(transform)
    .toPromise()

  expect(res).toEqual(['1', '2', '3'])
})

test('through stream', () => {
  _([1, 2, 3])
    .through(_()
      .map(x => x * 2)
      .map(x => x * 2),
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
  const res = _(h.fibonacci(6)).values()
  expect(res).toEqual([0, 1, 1, 2, 3, 5])
})

test('generator end event', () => {
  const res = []
  return new Promise(resolve => {
    _(h.fibonacci(6))
      .on('end', () => {
        resolve()
        expect(res).toEqual(['0', '1', '1', '2', '3', '5'])
      })
      .map(x => x.toString())
      .pipe(h.getSlowWritable(res, 0, 0))
  })
})

const asyncIterator = async function * (iterations = 10) {
  for (let i = 0; i < iterations; i++) {
    await h.sleep(0)
    yield i
  }
}

test('async generator', () => new Promise(resolve => {
  _(asyncIterator(10))
    .toArray(res => {
      resolve()
      expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
}))

test('async generator no exstream', async () => {
  const res = []
  for await (const x of asyncIterator(10)) {
    res.push(x)
  }
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('async exstream', async () => {
  let i = -1
  const res = await _(async (write, next) => {
    if (++i < 10) {
      await h.sleep(0)
      write(i)
      next()
    } else write(_.nil)
  }).toPromise()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('recursive generator', async () => {
  const gen = (i = 0) => _((write, next) => {
    if (i > 10) write(_.nil)
    else {
      write(i)
      next(gen(i + 1))
    }
  })

  const res = await _(gen()).toPromise()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('switch source', async () => {
  const gen = (i = 0) => _((write, next) => {
    if (i <= 5) {
      write(i++)
      next()
    } else next(_([6, 7, 8, 9, 10]))
  })

  const res = await _(gen()).toPromise()
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('switch source + backpressure', done => {
  const gen = (i = 0) => _((write, next) => {
    if (i <= 5) {
      write(i++)
      next()
    } else next(_([6, 7, 8, 9, 10]))
  })

  const res = []
  _(gen()).pipe(h.getSlowWritable(res, 1, 0)).on('finish', () => {
    done()
    expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

test('split', () => {
  const b = [Buffer.from('line1\nli'), Buffer.from('ne2\r\n'), Buffer.from('line3')]
  const res = _(b).split().values()
  expect(res).toEqual(['line1', 'line2', 'line3'])
})

test('splitBy', () => {
  const b = [Buffer.from('||line1||li'), Buffer.from('ne2||'), Buffer.from('line3||line4||')]
  const res = _(b).splitBy('||').values()
  expect(res).toEqual(['', 'line1', 'line2', 'line3', 'line4', ''])
})

test('splitBy with different encodings', () => {
  const b = [
    Buffer.from('line1||li', 'utf16le'),
    Buffer.from('ne2||', 'utf16le'),
    Buffer.from('line3||line4', 'utf16le'),
  ]
  const res = _(b).splitBy('||', 'utf16le').values()
  expect(res).toEqual(['line1', 'line2', 'line3', 'line4'])
})

test('split with multibyte chars', done => {
  const b = [
    'line1',
    Buffer.from('\n'),
    'line2',
    Buffer.from([0x0a /* \n */, 0xf0, 0x9f]),
    Buffer.from([0x98, 0x8f])]
  _(b).split().toArray(res => {
    done()
    expect(res).toEqual(['line1', 'line2', '😏'])
  })
})

test('toNodeStream', () => {
  const res = []
  return new Promise(resolve => {
    _([1, 2, 3])
      .map(x => x.toString())
      .toNodeStream()
      .on('end', () => {
        resolve()
        expect(res.map(x => x.toString())).toEqual(['1', '2', '3'])
      })
      .pipe(h.getSlowWritable(res, 0, 0))
  })
})

test('consume xs stream as an async iterator', async () => {
  const s = _([1,2,3]).map(async x => x).resolve().toAsyncIterator()
  const res = []
  for await (const x of s) {
    res.push(x)
  }
  expect(res).toEqual([1,2,3])
})

test('handling errors in source promise', async () => {
  const oops = Promise.reject(new Error('muahaha'))
  const err = []
  await _(oops)
    .errors(e => err.push(e))
    .values()
  expect(err.length).toBe(1)
  expect(err[0].message).toBe('muahaha')
})

test('forking', async () => {
  const s = _([1, 2, 3])
  const p1 = s.fork().map(x => x * 2 + 1).toPromise()
  const p2 = s.fork().map(x => x * 2 + 2).toPromise()
  const p3 = s.fork().map(x => x * 2 + 3).toPromise()
  const [r1, r2, r3] = await Promise.all([p1, p2, p3])
  expect(r1).toEqual([3, 5, 7])
  expect(r2).toEqual([4, 6, 8])
  expect(r3).toEqual([5, 7, 9])
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

test('tap', () => {
  const sideEffect = []
  const res = _([1, 2, 3])
    .tap(x => sideEffect.push(x))
    .map(x => x * 2)
    .values()

  expect(res).toEqual([2, 4, 6])
  expect(sideEffect).toEqual([1, 2, 3])
})

test('compact', () => {
  const res = _([1, 2, 0, null, undefined, false, ''])
    .compact()
    .values()

  expect(res).toEqual([1, 2])
})

test('find', () => {
  const res = _([1, 2, 0, null, undefined, ''])
    .find(x => x === 2)
    .value()

  expect(res).toEqual(2)
})

test('drop', () => {
  const res = _([1, 2, 3])
    .drop(1)
    .values()

  expect(res).toEqual([2, 3])
})

test('where', () => {
  const res = _([{ a: 'a', b: 'b' }, { a: 'a', b: 'c' }, { a: 'b', b: 'b' }])
    .where({ a: 'a', b: 'b' })
    .values()
  expect(res).toEqual([{ a: 'a', b: 'b' }])
})

test('stopWhen', () => {
  const res = _([1,2,3,4,5,6])
    .map(x => x * 2)
    .stopWhen(x => x === 10)
    .values()
  expect(res).toEqual([2,4,6,8,10])
})

test('stopWhenAsync', async () => {
  const res = await _([1,2,3,4,5,6])
    .map(async x => {
      await h.sleep(10)
      return x
    })
    .resolve()
    .map(x => x * 2)
    .stopWhen(x => x === 10)
    .values()
  expect(res).toEqual([2,4,6,8,10])
})

test('overpushing a paused stopWhen', () => new Promise(resolve => {
  const res = []
  _([1, 2, 3, 4, 5, 6])
    .collect()
    .flatten()
    .stopWhen(x => x === 2)
    .pipe(h.getSlowWritable(res, 0, 0))
    .on('finish', () => {
      resolve()
      expect(res).toEqual([1, 2])
    })
}))

test('overpushing a paused stopOnError', () => new Promise(resolve => {
  const res = []
  _([1, 2, 3, 4, 5, 6])
    .collect()
    .flatten()
    .map(x => {
      if(x === 2) throw Error('an error')
      return x
    })
    .stopOnError((err, push) => push(null, 'errHandled'))
    .pipe(h.getSlowWritable(res, 0, 0))
    .on('finish', () => {
      resolve()
      expect(res).toEqual([1, 'errHandled'])
    })
}))

test('findWhere', () => {
  const res = _([{ a: 'a', b: 'b' }, { a: 'b', b: 'c' }, { a: 'a', b: 'b' }])
    .findWhere({ a: 'a' })
    .value()
  expect(res).toEqual({ a: 'a', b: 'b' })
})

test('sort numbers', () => {
  const res = _([3, 8, 1, 4, 2]).sort().values()
  expect(res).toEqual([1, 2, 3, 4, 8])
})

test('sort strings', () => {
  const res = _(['1', '2', '10', '20']).sort().values()
  expect(res).toEqual(['1', '10', '2', '20'])
})

test('sort by', () => {
  const res = _(['1', '2', '10', '20'])
    .sortBy((a, b) => parseInt(a) > parseInt(b) ? 1 : -1)
    .values()
  expect(res).toEqual(['1', '2', '10', '20'])
})

test('multipipe', () => new Promise(resolve => {
  /*
    This demonstrates how to pipe multiple input streams into an exstream writer.
    You can even control parallelism and order.
    The whole chain has back-pressure.
  */
  const s = _()
  const res = []
  s.merge(2, false).pipe(h.getSlowWritable(res, 0, 1))
  const s1 = _(Array(10).fill('0'))
  const s2 = _(Array(10).fill('1'))
  s.write(s1)
  s.write(s2)
  s.write(_(['a', 'b']))
  s.write(_.nil)
  setImmediate(() => {
    resolve()
    /* eslint-disable array-element-newline */
    expect(res).toEqual([
      '0', '1', '0', '1', '0',
      '1', '0', '1', '0', '1',
      '0', '1', '0', '1', '0',
      '1', '0', '1', '0', '1',
      'a', 'b',
    ])
  })
}))
