const _ = require('../src/index.js')
const h = require('./helpers.js')
const EventEmitter = require('events').EventEmitter
const { kResume } = require('../src/stream-control.js')

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
  x[kResume]()
})

test('write', () => {
  const x = _()
  const y = []
  return new Promise((resolve) => {
    const z = x
      .consume((err, x, push, next) => {
        if (err) {
          y.push(err)
          next()
        } else if (x !== _.nil) {
          y.push(x)
          next()
        } else {
          push(null, _.nil)
        }
      })
      .on('end', () => {
        expect(y).toEqual([1, 2, 3, 4])
        resolve()
      })
    z[kResume]()
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

test('toArray', async () => {
  await expect(_([1, 2, 3]).toArray()).resolves.toEqual([1, 2, 3])
})

test('collect', async () => {
  await expect(_([1, 2, 3]).collect().toArray()).resolves.toEqual([[1, 2, 3]])
})

test('tap followed by drain replaces terminal each', async () => {
  let i = 1
  await _([1, 2, 3])
    .tap((x) => expect(x).toBe(i++))
    .drain()
})

const largeArray = (n) => {
  const res = []
  for (let i = 0; i < n; i++) {
    res.push(i)
  }
  return res
}
const k = largeArray(1000)
const k2 = k.map((x) => x * 2)

test('map1', async () => {
  await ((res) => {
    expect(res).toEqual(k2)
  })(
    await _(k)
      .map((x) => x * 2)
      .toArray(),
  )
})

test('map wrap', async () => {
  const res = await _(k)
    .map((x) => x * 2, { wrap: true })
    .toArray()

  expect(res.length).toEqual(k2.length)
  expect(res[345]).toEqual({ input: 345, output: 690 })
})

test('async map wrap', async () => {
  const res = await _(k)
    .map(async (x) => x * 2, { wrap: true })
    .mapAsync((value) => value)
    .toArray()

  expect(res.length).toEqual(k2.length)
  expect(res[345]).toEqual({ input: 345, output: 690 })
})

test('map set', async () => {
  const x = new Set([1, 2, 3])
  await ((res) => {
    expect(res).toEqual([2, 4, 6])
  })(
    await _(x)
      .map((x) => x * 2)
      .toArray(),
  )
})

test('batch', async () => {
  await ((res) => {
    expect(res).toEqual([
      [1, 2, 3],
      [4, 5],
    ])
  })(await _([1, 2, 3, 4, 5]).batch(3).toArray())
})

test('batch strange params', async () => {
  await ((res) => {
    expect(res).toEqual([
      [1, 2, 3],
      [4, 5],
    ])
  })(await _([1, 2, 3, 4, 5]).batch('3').toArray())
  let e = null
  try {
    _([1, 2, 3, 4, 5]).batch('nan')
  } catch (ex) {
    e = ex
  }
  expect(e).not.toBe(null)
  expect(e.message).toBe('error in .batch(). size must be a valid number')
})

test('uniq', async () => {
  await ((res) => {
    expect(res).toEqual([1, 2, 5])
  })(await _([1, 2, 2, 2, 5]).uniq().toArray())
})

test('uniqBy', async () => {
  await ((res) => {
    expect(res).toEqual([
      { a: 1, b: 1, c: 1 },
      { a: 1, b: 2, c: 2 },
    ])
  })(
    await _([
      { a: 1, b: 1, c: 1 },
      { a: 1, b: 2, c: 2 },
      { a: 1, b: 3, c: 1 },
    ])
      .uniqBy(['a', 'c'])
      .toArray(),
  )

  await ((res) => {
    expect(res).toEqual([
      { a: 1, b: 1, c: 1 },
      { a: 1, b: 2, c: 2 },
    ])
  })(
    await _([
      { a: 1, b: 1, c: 1 },
      { a: 1, b: 2, c: 2 },
      { a: 1, b: 3, c: 1 },
    ])
      .uniqBy('c')
      .toArray(),
  )

  await ((res) => expect(res).toEqual([1, 2]))(
    await _([1, 2, 3, 4])
      .uniqBy((x) => x % 2 === 0)
      .toArray(),
  )
})

test('flatten', async () => {
  await (async (res) => {
    expect(res).toEqual([1, [2, 3], 4, [5]])
    await ((res2) => {
      expect(res2).toEqual([1, 2, 3, 4, 5])
    })(await _(res).flatten().toArray())
  })(
    await _([
      [1, [2, 3]],
      [4, [5]],
    ])
      .flatten()
      .toArray(),
  )

  await ((res) => {
    expect(res).toEqual([1, 2, 3, 4, 5])
  })(await _([1, 2, 3, 4, 5]).batch(3).flatten().toArray())

  await ((res) => {
    expect(res).toEqual([1, 2, 3, 4, 5])
  })(await _([1, 2, 3, 4, 5]).flatten().toArray())
})

test('flatMap', async () => {
  const res = await _([1, 2, 3])
    .flatMap((x) => Array(x).fill(x))
    .toArray()
  expect(res).toEqual([1, 2, 2, 3, 3, 3])
})

test('flatten iterable', async () => {
  await ((res) => {
    expect(res).toEqual([1, 2, 3, 4, 5])
  })(
    await _([1, 2, 3, 4, 5])
      .batch(3)
      .map((x) => new Set(x))
      .flatten()
      .toArray(),
  )
})

test('synchronous tasks', async () => {
  const res = await _([1, 2, 3, 4, 5, 6])
    .map((x) => x * 2)
    .batch(3)
    .toArray()
  expect(res).toEqual([
    [2, 4, 6],
    [8, 10, 12],
  ])
})

test('synchronous reduce', async () => {
  const res = await _([1, 2, 3, 4, 5, 6])
    .reduce1((memo, x) => memo + x)
    .single()
  expect(res).toEqual(21)
})

test('async values', async () => {
  const res = await _([1, 2, 3, 4, 5, 6])
    .map(async (x) => x * 2)
    .mapAsync((value) => value)
    .batch(3)
    .toArray()
  expect(res).toEqual([
    [2, 4, 6],
    [8, 10, 12],
  ])
})

test('async value', async () => {
  const res = await _([1, 2, 3, 4, 5, 6])
    .map(async (x) => x * 2)
    .mapAsync((value) => value)
    .reduce1((a, b) => a + b)
    .single()
  expect(res).toBe(42)
})

test('through pipelines and pipeTo a destination', async () => {
  const res = []
  await _([1, 2, 3])
    .map((x) => x * 2)
    .map((x) => x.toString())
    .through(_().map((x) => x + x))
    .through(_.pipeline().map((x) => x + x))
    .pipeTo(h.getSlowWritable(res))

  expect(res).toEqual(['2222', '4444', '6666'])
})

test('through composes a functional operator without mutating Exstream', async () => {
  const duplicate = (stream) => stream.map((value) => value * 2)

  await expect(_([1, 2, 3]).through(duplicate).toArray()).resolves.toEqual([2, 4, 6])
  expect(_.extend).toBeUndefined()
})

test('filter', async () => {
  const res = await _([1, 2, 3])
    .filter((x) => x % 2 === 0)
    .toArray()
  expect(res).toEqual([2])
})

test('reject', async () => {
  const res = await _([1, 2, 3])
    .reject((x) => x % 2 === 0)
    .toArray()
  expect(res).toEqual([1, 3])
})

test('through pipeline', async () => {
  await ((res) => {
    expect(res).toEqual([4, 8, 12])
  })(
    await _([1, 2, 3])
      .through(
        _.pipeline()
          .map((x) => x * 2)
          .map((x) => x * 2),
      )
      .toArray(),
  )
})

test('through accepts null', () => {
  const s = _([1, 2, 3])
  const s1 = s.through(null)
  expect(s).toBe(s1)
})

test('through stream', async () => {
  await ((res) => {
    expect(res).toEqual([4, 8, 12])
  })(
    await _([1, 2, 3])
      .through(
        _()
          .map((x) => x * 2)
          .map((x) => x * 2),
      )
      .toArray(),
  )

  let exception = false
  try {
    _([1, 2, 3]).through(2)
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
})

test('toArray', async () => {
  const res = await _([1, 2, 3])
    .map((x) => x * 2)
    .toArray()

  expect(res).toEqual([2, 4, 6])
})

test('promise in constructor', async () => {
  const p = async () => {
    await h.sleep(10)
    return 'x'
  }

  await expect(_(p()).toArray()).resolves.toEqual(['x'])
})

test('generator', async () => {
  const res = await _(h.fibonacci(6)).toArray()
  expect(res).toEqual([0, 1, 1, 2, 3, 5])
})

test('generator end event', async () => {
  const res = []
  await _(h.fibonacci(6))
    .map((x) => x.toString())
    .pipeTo(h.getSlowWritable(res, 0, 0))
  expect(res).toEqual(['0', '1', '1', '2', '3', '5'])
})

const asyncIterator = async function* (iterations = 10) {
  for (let i = 0; i < iterations; i++) {
    await h.sleep(0)
    yield i
  }
}

test('async generator', async () => {
  await expect(_(asyncIterator(10)).toArray()).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('async generator no exstream', async () => {
  const res = []
  for await (const x of asyncIterator(10)) {
    res.push(x)
  }
  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('split', async () => {
  const b = [Buffer.from('line1\nli'), Buffer.from('ne2\r\n'), Buffer.from('line3')]
  const res = await _(b).split().toArray()
  expect(res).toEqual(['line1', 'line2', 'line3'])
})

test('splitBy', async () => {
  const b = [Buffer.from('||line1||li'), Buffer.from('ne2||'), Buffer.from('line3||line4||')]
  const res = await _(b).splitBy('||').toArray()
  expect(res).toEqual(['', 'line1', 'line2', 'line3', 'line4', ''])
})

test('splitBy with different encodings', async () => {
  const b = [
    Buffer.from('line1||li', 'utf16le'),
    Buffer.from('ne2||', 'utf16le'),
    Buffer.from('line3||line4', 'utf16le'),
  ]
  const res = await _(b).splitBy('||', 'utf16le').toArray()
  expect(res).toEqual(['line1', 'line2', 'line3', 'line4'])
})

test('split with multibyte chars', async () => {
  const b = [
    'line1',
    Buffer.from('\n'),
    'line2',
    Buffer.from([0x0a /* \n */, 0xf0, 0x9f]),
    Buffer.from([0x98, 0x8f]),
  ]
  const res = await _(b).split().toArray()

  expect(res).toEqual(['line1', 'line2', '😏'])
})

test('toNodeReadable', () => {
  const res = []
  return new Promise((resolve) => {
    _([1, 2, 3])
      .map((x) => x.toString())
      .toNodeReadable()
      .on('end', () => {
        resolve()
        expect(res.map((x) => x.toString())).toEqual(['1', '2', '3'])
      })
      .pipe(h.getSlowWritable(res, 0, 0))
  })
})

test('consume xs stream as an async iterator', async () => {
  const s = _([1, 2, 3])
    .map(async (x) => x)
    .mapAsync((value) => value)
  const res = []
  for await (const x of s) {
    res.push(x)
  }
  expect(res).toEqual([1, 2, 3])
})

test('handling errors in source promise', async () => {
  const oops = Promise.reject(new Error('muahaha'))
  const err = []
  await _(oops)
    .errors((e) => err.push(e))
    .toArray()
  expect(err.length).toBe(1)
  expect(err[0].message).toBe('muahaha')
})

test('forking', async () => {
  const s = _([1, 2, 3])
  const p1 = s
    .fork()
    .map((x) => x * 2 + 1)
    .toArray()
  const p2 = s
    .fork()
    .map((x) => x * 2 + 2)
    .toArray()
  const p3 = s
    .fork()
    .map((x) => x * 2 + 3)
    .toArray()
  const [r1, r2, r3] = await Promise.all([p1, p2, p3])
  expect(r1).toEqual([3, 5, 7])
  expect(r2).toEqual([4, 6, 8])
  expect(r3).toEqual([5, 7, 9])
})

test('not more than 1 consumer if not fork', () => {
  const s = _()
  s.map((x) => x)
  let exception = false
  try {
    s.map((x) => x * 2)
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
  s.fork().map((x) => x)
})

test('tap', async () => {
  const sideEffect = []
  const res = await _([1, 2, 3])
    .tap((x) => sideEffect.push(x))
    .map((x) => x * 2)
    .toArray()

  expect(res).toEqual([2, 4, 6])
  expect(sideEffect).toEqual([1, 2, 3])
})

test('compact', async () => {
  const res = await _([1, 2, 0, null, undefined, false, '']).compact().toArray()

  expect(res).toEqual([1, 2])
})

test('find', async () => {
  const res = await _([1, 2, 0, null, undefined, ''])
    .find((x) => x === 2)
    .single()

  expect(res).toEqual(2)
})

test('drop', async () => {
  const res = await _([1, 2, 3]).drop(1).toArray()

  expect(res).toEqual([2, 3])
})

test('where', async () => {
  const res = await _([
    { a: 'a', b: 'b' },
    { a: 'a', b: 'c' },
    { a: 'b', b: 'b' },
  ])
    .where({ a: 'a', b: 'b' })
    .toArray()
  expect(res).toEqual([{ a: 'a', b: 'b' }])
})

test('stopWhen', async () => {
  const res = await _([1, 2, 3, 4, 5, 6])
    .map((x) => x * 2)
    .stopWhen((x) => x === 10)
    .toArray()
  expect(res).toEqual([2, 4, 6, 8, 10])
})

test('stopWhenAsync', async () => {
  const res = await _([1, 2, 3, 4, 5, 6])
    .map(async (x) => {
      await h.sleep(10)
      return x
    })
    .mapAsync((value) => value)
    .map((x) => x * 2)
    .stopWhen((x) => x === 10)
    .toArray()
  expect(res).toEqual([2, 4, 6, 8, 10])
})

test('overpushing a paused stopWhen', async () => {
  const res = []
  await _([1, 2, 3, 4, 5, 6])
    .collect()
    .flatten()
    .stopWhen((x) => x === 2)
    .pipeTo(h.getSlowWritable(res, 0, 0))
  expect(res).toEqual([1, 2])
})

test('overpushing a paused stopOnError', async () => {
  const res = []
  await _([1, 2, 3, 4, 5, 6])
    .collect()
    .flatten()
    .map((x) => {
      if (x === 2) throw Error('an error')
      return x
    })
    .stopOnError((err, push) => push(null, 'errHandled'))
    .pipeTo(h.getSlowWritable(res, 0, 0))
  expect(res).toEqual([1, 'errHandled'])
})

test('findWhere', async () => {
  const res = await _([
    { a: 'a', b: 'b' },
    { a: 'b', b: 'c' },
    { a: 'a', b: 'b' },
  ])
    .findWhere({ a: 'a' })
    .single()
  expect(res).toEqual({ a: 'a', b: 'b' })
})

test('sort numbers', async () => {
  const res = await _([3, 8, 1, 4, 2]).sort().toArray()
  expect(res).toEqual([1, 2, 3, 4, 8])
})

test('sort strings', async () => {
  const res = await _(['1', '2', '10', '20']).sort().toArray()
  expect(res).toEqual(['1', '10', '2', '20'])
})

test('sort by', async () => {
  const res = await _(['1', '2', '10', '20'])
    .sortBy((a, b) => (parseInt(a) > parseInt(b) ? 1 : -1))
    .toArray()
  expect(res).toEqual(['1', '2', '10', '20'])
})

test('multipipe', async () => {
  /*
    This demonstrates how to pipe multiple input streams into an exstream writer.
    You can even control concurrency and order.
    The whole chain has back-pressure.
  */
  const s = _()
  const res = []
  const completion = s
    .merge({ concurrency: 2, ordered: false })
    .pipeTo(h.getSlowWritable(res, 0, 1))
  const s1 = _(Array(10).fill('0'))
  const s2 = _(Array(10).fill('1'))
  s.write(s1)
  s.write(s2)
  s.write(_(['a', 'b']))
  s.write(_.nil)
  await completion
  expect(res).toHaveLength(22)
  expect(res.filter((x) => x === '0')).toHaveLength(10)
  expect(res.filter((x) => x === '1')).toHaveLength(10)
  expect(res.filter((x) => x !== '0' && x !== '1')).toEqual(['a', 'b'])
})