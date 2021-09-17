const _ = require('./utils.js')
const { Exstream, ExstreamError } = require('./exstream.js')
const { Transform } = require('stream')
const { StringDecoder } = require('string_decoder')

const _m = module.exports = {}

_m.split = _.curry((encoding, s) => _m.splitBy(/\r?\n/, encoding, s))

_m.splitBy = _.curry((regexp, encoding, s) => {
  const decoder = new StringDecoder(encoding)
  let buffer = ''

  return s.consumeSync((err, x, push) => {
    if (err) return push(err)
    const isNil = x === _.nil
    const str = buffer + (isNil ? decoder.end() : decoder.write(x))
    const tokens = str.split(regexp)
    buffer = tokens.pop()
    for (let i = 0, len = tokens.length; i < len; i++) {
      push(null, tokens[i])
    }
    if (isNil) {
      push(null, buffer)
      push(null, _.nil)
    }
  })
})

_m.map = _.curry((fn, options, s) => s.consumeSync((err, x, push) => {
  if (err) {
    push(err)
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      let res = fn(x)
      const probablyPromise = res && res.then && res.catch && !_.isExstream(res)
      if (probablyPromise) res = res.catch(e => { throw new ExstreamError(e, x) })
      if (!options || !options.wrap) {
        return push(null, res)
      } else if (probablyPromise) {
        push(null, res.then(y => ({ input: x, output: y })))
      } else {
        push(null, { input: x, output: res })
      }
    } catch (e) {
      push(new ExstreamError(e, x))
    }
  }
}))

_m.where = _.curry((props, s) => s.filter(x => {
  for (const p in props) {
    if (x[p] !== props[p]) return false
  }
  return true
}))

_m.ratelimit = _.curry((num, ms, s) => {
  let sent = 0
  let startWindow
  return s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(null, _.nil)
    } else if (sent === 0) {
      startWindow = process.hrtime.bigint()
      sent++
      push(null, x)
      next()
    } else if (sent < num) {
      sent++
      push(null, x)
      next()
    } else if (Number((process.hrtime.bigint() - startWindow) / 1000000n) > ms) {
      startWindow = process.hrtime.bigint()
      sent = 1
      push(null, x)
      next()
    } else {
      setTimeout(() => {
        startWindow = process.hrtime.bigint()
        sent = 1
        push(null, x)
        next()
      }, ms - Math.round(Number((process.hrtime.bigint() - startWindow) / 1000000n)))
    }
  })
})

_m.throttle = _.curry((ms, s) => {
  let last = 0 - ms
  return s.consume((err, x, push, next) => {
    const now = new Date().getTime()
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(null, _.nil)
    } else if (now - ms >= last) {
      last = now
      push(null, x)
      next()
    } else {
      next()
    }
  })
})

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

_m.flatMap = _.curry((fn, s) => s.map(fn).flatten())

_m.toArray = _.curry((fn, s) => s.collect().pull((err, x) => {
  if (err) {
    ;(s.endOfChain || s).emit('error', err)
  } else {
    fn(x)
  }
}))

_m.filter = _.curry((fn, s) => s.consumeSync((err, x, push) => {
  if (err) {
    push(err)
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      const res = fn(x)
      if (res) push(null, x)
    } catch (e) {
      push(new ExstreamError(e, x))
    }
  }
}))

_m.reject = _.curry((fn, s) => s.consumeSync((err, x, push) => {
  if (err) {
    push(err)
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      const res = fn(x)
      if (!res) push(null, x)
    } catch (e) {
      push(new ExstreamError(e, x))
    }
  }
}))

_m.asyncFilter = _.curry((fn, s) => s.consume(async (err, x, push, next) => {
  if (err) {
    push(err)
    next()
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      const res = await fn(x)
      if (res) push(null, x)
      next()
    } catch (e) {
      push(new ExstreamError(e, x))
      next()
    }
  }
}))

_m.batch = _.curry((size, s) => {
  let buffer = []
  size = parseFloat(size)
  if (isNaN(size)) throw Error('error in .batch(). size must be a valid number')
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

_m.pluck = _.curry((field, defaultValue, s) => {
  const getter = _.makeGetter(field, defaultValue)
  return s.map(getter)
})

_m.pick = _.curry((fields, s) => s.map(x => {
  const res = {}
  let hasKey
  for (let i = 0, len = fields.length; i < len; i++) {
    try {
      hasKey = fields[i] in x
    } catch (e) {
      throw new ExstreamError(Error('error in .pick(). expected object, got ' + (typeof x)), x)
    }
    if (hasKey) res[fields[i]] = x[fields[i]]
  }
  return res
}))

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
        push(new ExstreamError(e, x))
      }
    }
  })
})

_m.then = _.curry((fn, s) => s.map(x => x.then(fn)))

_m.catch = _.curry((fn, s) => s.map(x => x.catch(fn)))

_m.resolve = _.curry((parallelism, preserveOrder, s) => {
  const promises = []
  let ended = false

  function handlePromiseResult (isError, res, resPointer, push, next) {
    resPointer.result = res
    resPointer.isError = isError
    const idx = promises.indexOf(resPointer)

    if (preserveOrder) {
      while (_.has(promises[0], 'result')) {
        const item = promises.shift()
        if (item.isError) push(item.result)
        else push(null, item.result)
      }
    } else {
      promises.splice(idx, 1)
      if (isError) push(res)
      else push(null, res)
    }

    if (ended && promises.length === 0) push(null, _.nil)
    else if (!preserveOrder || idx === 0) next()
  }

  return s.consume((err, el, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (el === _.nil) {
      if (promises.length === 0) push(null, _.nil)
      else ended = true
    } else if (!_.isPromise(el)) {
      push(new ExstreamError(Error('error in .resolve(). item must be a promise'), el))
      next()
    } else {
      const resPointer = {}
      promises.push(resPointer)
      el.then(res => handlePromiseResult(false, res, resPointer, push, next))
        .catch(res => handlePromiseResult(true, res, resPointer, push, next))
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

_m.toPromise = s => new Promise((resolve, reject) => s.once('error', reject).toArray(res => {
  s.off('error', reject)
  resolve(res)
}))

_m.toNodeStream = _.curry((options, s) => s.pipe(new Transform({
  transform: function (chunk, enc, cb) {
    this.push(chunk)
    cb()
  },
  ...options,
})))

_m.slice = _.curry((start, end, s) => {
  let index = 0
  start = parseFloat(start)
  end = parseFloat(end)

  if (start === 0 && end === Infinity) return s
  if (start >= end) throw Error('error in .slice(). start must be lower than end')
  if (isNaN(start) || isNaN(end)) throw Error('error in .slice(). start and end must be numbers')

  const s1 = s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      if (index >= end) {
        // if I'm terminating the stream before the end of its source,
        // I've to call .end() or .destroy() instead of pushing nil in
        // order to back propagate destroy and to remove the stream from
        // the consumers of its source
        s1.destroy()
      } else if (index >= start) {
        push(null, x)
      }
      index++
    }
  })
  return s1
})

_m.take = _.curry((n, s) => s.slice(0, n))

_m.drop = _.curry((n, s) => s.slice(n, Infinity))

_m.reduce = _.curry((fn, accumulator, s) => {
  const s1 = s.consumeSync((err, x, push) => {
    if (x === _.nil) {
      push(null, accumulator)
      push(null, _.nil)
    } else if (err) {
      push(err)
    } else {
      try {
        accumulator = fn(accumulator, x)
      } catch (e) {
        try {
          push(new ExstreamError(e, x))
        } finally {
          accumulator = undefined
          s1.destroy()
        }
      }
    }
  })
  return s1
})

_m.reduce1 = _.curry((fn, s) => {
  let init = false
  let accumulator
  const s1 = s.consumeSync((err, x, push) => {
    if (x === _.nil) {
      push(null, accumulator)
      push(null, _.nil)
    } else if (err) {
      push(err)
    } else if (!init) {
      init = true
      accumulator = x
    } else {
      try {
        accumulator = fn(accumulator, x)
      } catch (e) {
        try {
          push(new ExstreamError(e, x))
        } finally {
          accumulator = undefined
          s1.destroy()
        }
      }
    }
  })
  return s1
})

_m.asyncReduce = _.curry((fn, accumulator, s) => {
  const s1 = s.consume(async (err, x, push, next) => {
    if (x === _.nil) {
      push(null, accumulator)
      push(null, _.nil)
    } else if (err) {
      push(err)
      next()
    } else {
      try {
        accumulator = await fn(accumulator, x)
        next()
      } catch (e) {
        try {
          push(new ExstreamError(e, x))
        } finally {
          accumulator = undefined
          s1.destroy()
        }
      }
    }
  })
  return s1
})

_m.groupBy = _.curry((fnOrString, s) => {
  const getter = _.isString(fnOrString) ? _.makeGetter(fnOrString, 'null') : fnOrString
  return s.reduce((accumulator, x) => {
    const key = getter(x)
    if (!_.has(accumulator, key)) accumulator[key] = []
    accumulator[key].push(x)
    return accumulator
  }, {})
})

_m.sortBy = _.curry((fn, s) => s.collect().flatMap(x => x.sort(fn)))
_m.sort = s => _m.sortBy(undefined, s)

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
  },
}, {
  get (target, propKey, receiver) {
    if (target[propKey] || !Exstream.prototype[propKey]) return Reflect.get(...arguments)
    return function (...args) {
      target.definitions.push({ method: propKey, args })
      return this
    }
  },
})
