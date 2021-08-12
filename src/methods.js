const _ = require('./utils.js')
const Exstream = require('./exstream.js')
const { Transform } = require('stream')
const { StringDecoder: Decoder } = require('string_decoder')

const _m = module.exports = {}

_m.map = (f, s) => s.consume((err, x, push, next) => {
  if (err) {
    push(err)
    next()
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      push(null, f(x))
    } catch (e) {
      push(e)
    }
    next()
  }
})

_m.collect = s => {
  const xs = []
  return s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(null, xs)
      push(null, _.nil)
    } else {
      xs.push(x)
      next()
    }
  })
}

_m.pull = (f, s) => {
  const s2 = s.consume((err, x) => {
    s2.source._removeConsumer(s2)
    f(err, x)
  })
  s2.resume()
}

_m.each = (f, s) => {
  const s2 = s.consume((err, x, push, next) => {
    if (err) {
      this.emit('error', err)
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      f(x)
      next()
    }
  })
  s2.resume()
  return s2
}

_m.flatten = s => s.consume((err, x, push, next) => {
  if (err) {
    push(err)
    next()
  } else if (x === _.nil) {
    push(err, x)
  } else if (_.isIterable(x)) {
    for (const y of x) push(null, y)
    next()
  } else {
    push(null, x)
    next()
  }
})

_m.toArray = (f, s) => s.collect().pull((err, x) => {
  if (err) {
    this.emit('error', err)
  } else {
    f(x)
  }
})

_m.fork = s => {
  s._autostart = false
  const res = new Exstream()
  s._addConsumer(res, true)
  return res
}

_m.filter = (f, s) => s.consume((err, x, push, next) => {
  if (err) {
    push(err)
    next()
  } else if (x === _.nil) {
    push(err, x)
  } else {
    try {
      if (f(x)) push(null, x)
    } catch (e) {
      push(e)
    }
    next()
  }
})

_m.batch = (size, s) => {
  let buffer = []
  return s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
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
      next()
    }
  })
}

_m.uniq = s => {
  const seen = new Set()
  return s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(err, x)
    } else {
      if (!seen.has(x)) {
        seen.add(x)
        push(null, x)
      }
      next()
    }
  })
}

_m.uniqBy = (cfg, s) => {
  const seen = new Set()
  const isFn = _.isFunction(cfg)
  if (!isFn && !Array.isArray(cfg)) cfg = [cfg]

  const fn = !isFn ? x => cfg.map(f => x[f]).join('_') : cfg

  return s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const k = fn(x)
      if (!seen.has(k)) {
        seen.add(k)
        push(null, x)
      }
      next()
    }
  })
}

_m.merge = s => {
  const merged = new Exstream()
  let toBeEnded = 0
  s.each(subS => {
    toBeEnded++
    subS.consume((err, x, push, next) => {
      if (x === _.nil) {
        if (--toBeEnded === 0) merged.write(_.nil)
      } else if (!merged.write(err || x)) {
        merged.once('drain', next)
      } else {
        next()
      }
    })
    setImmediate(subS.resume)
  })
  return merged
}

_m.then = (fn, s) => s.map(x => x.then(fn))

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
    } else if (!x.then) {
      push(Error('item must be a promise'))
      next()
    } else {
      const resPointer = {}
      promises.push(resPointer)
      x.then(res => {
        const idx = promises.indexOf(resPointer)
        if (preserveOrder) {
          resPointer.result = res
          while (_.has(promises[0], 'result')) push(null, promises.shift().result)
          if (ended && promises.length === 0) push(null, _.nil)
          else if (idx === 0) next()
        } else {
          promises.splice(idx, 1)
          push(null, res)
          if (ended && promises.length === 0) push(null, _.nil)
          else next()
        }
      })
      if (promises.length < parallelism) next()
    }
  })
}

_m.through = (target, s) => {
  if (_.isExstream(target)) {
    const findParent = x => x.source ? findParent(x.source) : x
    s._addConsumer(findParent(target))
    return target
  } else if (_.isExstreamPipeline(target)) {
    const { begin, end } = target.generateStream()
    s._addConsumer(begin)
    return end
  } else if (_.isReadableStream(target)) {
    s.pipe(target)
    return new Exstream(target)
  } else throw Error('You must pass an exstream instance or a node stream')
}

_m.toPromise = s => new Promise((resolve, reject) => s.toArray(resolve))

_m.toNodeStream = (options, s) => s.pipe(new Transform({
  transform: function (chunk, enc, cb) {
    this.push(chunk)
    cb()
  },
  ...options
}))

_m.pipeline = () => new Proxy({
  __exstream_pipeline__: true,
  toNodeStream: function (bufferSize = 10000) {
    let { begin, end } = this.generateStream()
    end = end.batch(bufferSize)
    const wrapper = new Exstream((push, next) => {
      end.pull((err, x) => {
        if (err) {
          push(err)
          next()
        } else if (x === _.nil) {
          push(null, _.nil)
        } else {
          for (const b of x) push(null, b)
          next()
        }
      })
    })

    wrapper.__exstream__ = false
    wrapper.write = x => begin.write(x)
    wrapper.end = () => begin.end()
    begin.on('drain', () => wrapper.emit('drain'))
    return wrapper
  },
  generateStream: function () {
    const s = new Exstream()
    let curr = s
    for (const { method, args } of this.definitions) curr = curr[method](...args)
    return { begin: s, end: curr }
  },
  definitions: []
}, {
  get (target, propKey, receiver) {
    if (target[propKey] || !_m[propKey]) return Reflect.get(...arguments)
    return function (...args) {
      target.definitions.push({ method: propKey, args })
      return this
    }
  }
})

_m.csv = function (opts, s) {
  opts = {
    quote: '"',
    separator: ',',
    encoding: 'utf8',
    header: true,
    ...opts
  }
  const decoder = new Decoder()
  let buffer = ''
  let row = []
  let col = 0
  let quote = false

  function drain (x, push, isEnd = false) {
    buffer = buffer + decoder.write(x)
    if ((buffer.endsWith(opts.quote) || buffer.endsWith('\r')) && !isEnd) return

    for (let c = 0; c < buffer.length; c++) {
      const cc = buffer[c]; const nc = buffer[c + 1]
      row[col] = row[col] || ''
      if (cc === opts.quote && quote && nc === opts.quote) { row[col] += cc; ++c; continue }
      if (cc === opts.quote) { quote = !quote; continue }
      if (cc === opts.separator && !quote) { ++col; continue }
      if (cc === '\r' && nc === '\n' && !quote) { ++c }
      if ((cc === '\n' || cc === '\r') && !quote) {
        col = 0
        push(null, row)
        row = []
        if (s.paused) return
        continue
      }
      row[col] += cc
    }
    buffer = ''
  }

  return s.consume(function (err, x, push, next) {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      drain(decoder.end(), push, true)
      push(null, _.nil)
    } else {
      drain(x, push)
      next()
    }
  })
}
