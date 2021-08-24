const _ = require('./utils.js')
const Exstream = require('./exstream.js')
const { Transform } = require('stream')

const _m = module.exports = {}

_m.map = _.curry((f, s) => s.consumeSync((err, x, push) => {
  if (err) {
    push(err)
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      push(null, f(x))
    } catch (e) {
      push(e)
    }
  }
}))

_m.collect = s => {
  const xs = []
  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(null, xs)
      push(null, _.nil)
    } else {
      xs.push(x)
    }
  })
}

_m.flatten = s => s.consumeSync((err, x, push, next) => {
  if (err) {
    push(err)
  } else if (x === _.nil) {
    push(err, x)
  } else if (_.isIterable(x)) {
    for (const y of x) push(null, y)
  } else {
    push(null, x)
  }
})

_m.flatMap = _.curry((f, s) => s.map(f).flatten())

_m.toArray = _.curry((f, s) => s.collect().pull((err, x) => {
  if (err) {
    ;(s.endOfChain || s).emit('error', err)
  } else {
    f(x)
  }
}))

_m.filter = _.curry((f, s) => s.consumeSync((err, x, push) => {
  if (err) {
    push(err)
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      const res = f(x)
      if (res) push(null, x)
    } catch (e) {
      push(e)
    }
  }
}))

_m.asyncFilter = _.curry((f, s) => s.consume(async (err, x, push, next) => {
  if (err) {
    push(err)
    next()
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      const res = await f(x)
      if (res) push(null, x)
      next()
    } catch (e) {
      push(e)
      next()
    }
  }
}))

_m.batch = _.curry((size, s) => {
  let buffer = []
  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      if (buffer.length) push(null, buffer)
      buffer = []
      push(err, x)
    } else {
      buffer.push(x)
      if (buffer.length >= size) {
        push(null, buffer)
        buffer = []
      }
    }
  })
})

_m.uniq = s => {
  const seen = new Set()
  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      if (!seen.has(x)) {
        seen.add(x)
        push(null, x)
      }
    }
  })
}

_m.pluck = _.curry((f, s) => s.map(x => x[f]))

_m.uniqBy = _.curry((cfg, s) => {
  const seen = new Set()
  const isFn = _.isFunction(cfg)
  if (!isFn && !Array.isArray(cfg)) cfg = [cfg]

  const fn = !isFn ? x => cfg.map(f => x[f]).join('_') : cfg

  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      try {
        const k = fn(x)
        if (!seen.has(k)) {
          seen.add(k)
          push(null, x)
        }
      } catch (e) {
        push(e)
      }
    }
  })
})

_m.then = _.curry((fn, s) => s.map(x => x.then(fn)))

_m.catch = _.curry((fn, s) => s.map(x => x.catch(fn)))

_m.resolve = _.curry((parallelism, preserveOrder, s) => {
  const promises = []
  let ended = false

  return s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      if (promises.length === 0) push(err, x)
      else ended = true
    } else if (!_.isPromise(x)) {
      push(Error('item must be a promise'))
      next()
    } else {
      const resPointer = {}
      promises.push(resPointer)
      const handlePromiseResult = isError => res => {
        const idx = promises.indexOf(resPointer)
        if (preserveOrder) {
          resPointer.result = res
          resPointer.isError = isError
          while (_.has(promises[0], 'result')) {
            const item = promises.shift()
            if (item.isError) push(item.result)
            else push(null, item.result)
          }
          if (ended && promises.length === 0) push(null, _.nil)
          else if (idx === 0) next()
        } else {
          promises.splice(idx, 1)
          if (isError) push(res)
          else push(null, res)
          if (ended && promises.length === 0) push(null, _.nil)
          else next()
        }
      }
      x.then(handlePromiseResult(false), handlePromiseResult(true))
      if (promises.length < parallelism) next()
    }
  })
})

_m.errors = _.curry((fn, s) => s.consumeSync((err, x, push) => {
  if (x === _.nil) {
    push(null, _.nil)
  } else if (err) {
    fn(err, push)
  } else {
    push(null, x)
  }
}))

_m.toPromise = s => new Promise((resolve, reject) => s.once('error', reject).toArray(resolve))

_m.toNodeStream = _.curry((options, s) => s.pipe(new Transform({
  transform: function (chunk, enc, cb) {
    this.push(chunk)
    cb()
  },
  ...options
})))

_m.slice = _.curry((start, end, s) => {
  let index = 0
  start = typeof start !== 'number' || start < 0 ? 0 : start
  end = typeof end !== 'number' ? Infinity : end

  if (start === 0 && end === Infinity) return this
  if (start >= end) throw new Error('start must be lower than end')

  return s.consumeSync((err, x, push) => {
    const done = x === _.nil
    if (err) {
      push(err)
    } else if (!done && index++ >= start) {
      push(null, x)
    }

    if (done || index >= end) {
      push(null, _.nil)
    }
  })
})

_m.take = _.curry((n, s) => s.slice(0, n))

_m.drop = _.curry((n, s) => s.slice(n, Infinity))

_m.reduce = _.curry((z, f, s) => {
  return s.consumeSync((err, x, push) => {
    if (x === _.nil) {
      push(null, z)
      push(null, _.nil)
    } else if (err) {
      push(err)
    } else {
      try {
        z = f(z, x)
      } catch (e) {
        push(e)
        push(null, _.nil)
      }
    }
  })
})

_m.asyncReduce = _.curry((z, f, s) => {
  return s.consume(async (err, x, push, next) => {
    if (x === _.nil) {
      push(null, z)
      push(null, _.nil)
    } else if (err) {
      push(err)
      next()
    } else {
      try {
        z = await f(z, x)
        next()
      } catch (e) {
        push(e)
        push(null, _.nil)
      }
    }
  })
})

_m.makeAsync = _.curry((maxSyncExecutionTime, s) => {
  let lastSnapshot = null
  let start = null
  let end = null
  return s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      lastSnapshot = process.hrtime.bigint()
      if (start === null) start = lastSnapshot
      else end = lastSnapshot
      if (end !== null && (end - start) / 1000000n > maxSyncExecutionTime) {
        setImmediate(() => {
          push(null, x)
          start = process.hrtime.bigint()
          next()
        })
      } else {
        push(null, x)
        next()
      }
    }
  })
})

_m.tap = _.curry((fn, s) => s.map(x => { fn(x); return x }))

_m.compact = s => s.filter(x => x)

_m.find = _.curry((fn, s) => s.filter(fn).take(1))

_m.pipeline = () => new Proxy({
  __exstream_pipeline__: true,
  definitions: [],
  generateStream: function () {
    const s = new Exstream()
    let curr = s
    for (const { method, args } of this.definitions) curr = curr[method](...args)
    s.endOfChain = curr
    return s
  }
}, {
  get (target, propKey, receiver) {
    if (target[propKey] || !Exstream.prototype[propKey]) return Reflect.get(...arguments)
    return function (...args) {
      target.definitions.push({ method: propKey, args })
      return this
    }
  }
})
