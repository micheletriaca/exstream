const _ = require('./utils.js')
const Exstream = require('./exstream.js')
const { Transform } = require('stream')

const _m = module.exports = {}

_m.map = (f, s) => s.consumeSync((err, x, push) => {
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

_m.toArray = (f, s) => s.collect().pull((err, x) => {
  if (err) {
    ;(s.endOfChain || s).emit('error', err)
  } else {
    f(x)
  }
})

_m.filter = (f, s) => s.consume((err, x, push, next) => {
  if (err) {
    push(err)
    next()
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      const res = f(x)
      if (res.then) {
        res.then(res2 => {
          if (res2) push(null, x)
          next()
        }).catch(e => {
          push(e)
          next()
        })
      } else {
        if (res) push(null, x)
        next()
      }
    } catch (e) {
      push(e)
      next()
    }
  }
})

_m.batch = (size, s) => {
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
}

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

_m.pluck = (f, s) => s.map(x => x[f])

_m.uniqBy = (cfg, s) => {
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
}

_m.then = (fn, s) => s.map(x => x.then(fn))

_m.catch = (fn, s) => s.map(x => x.catch(fn))

_m.resolve = (parallelism = 1, preserveOrder = true, s) => {
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
}

_m.errors = (fn, s) => s.consumeSync((err, x, push) => {
  if (x === _.nil) {
    push(null, _.nil)
  } else if (err) {
    fn(err, push)
  } else {
    push(null, x)
  }
})

_m.toPromise = s => new Promise((resolve, reject) => s.once('error', reject).toArray(resolve))

_m.toNodeStream = (options, s) => s.pipe(new Transform({
  transform: function (chunk, enc, cb) {
    this.push(chunk)
    cb()
  },
  ...options
}))

_m.slice = (start, end, s) => {
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
}

_m.take = (n, s) => s.slice(0, n)

_m.reduce = (z, f, s) => {
  return s.consume((err, x, push, next) => {
    if (x === _.nil) {
      push(null, z)
      push(null, _.nil)
    } else if (err) {
      push(err)
      next()
    } else {
      try {
        const k = f(z, x)
        if (k.then) {
          k.then(kres => {
            z = kres
            next()
          }).catch(e => {
            push(e)
            push(null, _.nil)
          })
        } else {
          z = k
          next()
        }
      } catch (e) {
        push(e)
        push(null, _.nil)
      }
    }
  })
}

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
