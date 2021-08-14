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
      ;(s.endOfChain || s).emit('error', err)
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
    ;(s.endOfChain || s).emit('error', err)
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
      try {
        const k = fn(x)
        if (!seen.has(k)) {
          seen.add(k)
          push(null, x)
        }
      } catch (e) {
        push(e)
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
    if (!_.isExstream(subS)) throw Error('Merge can merge ONLY exstream instances')
    const k = subS.consume((err, x, push, next) => {
      if (x === _.nil) {
        if (--toBeEnded === 0) merged.write(_.nil)
      } else if (!merged.write(err || x)) {
        merged.once('drain', next)
      } else {
        next()
      }
    })
    setImmediate(k.resume)
  })
  return merged
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

_m.through = (target, s) => {
  if (_.isExstream(target)) {
    const findParent = x => x.source ? findParent(x.source) : x
    s._addConsumer(findParent(target))
    return target
  } else if (_.isExstreamPipeline(target)) {
    const pipelineInstance = target.generateStream()
    s._addConsumer(pipelineInstance)
    return pipelineInstance
  } else if (_.isReadableStream(target)) {
    s.pipe(target)
    return new Exstream(target)
  } else throw Error('You must pass a non consumed exstream instance, a pipeline or a node stream')
}

_m.errors = (fn, s) => s.consume((err, x, push, next) => {
  if (x === _.nil) {
    push(null, _.nil)
  } else if (err) {
    fn(err, push)
    next()
  } else {
    push(null, x)
    next()
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
    header: false,
    ...opts
  }
  const decoder = new Decoder(opts.encoding)
  let buffer = ''
  let row = []
  let col = 0
  let quote = false
  let firstRow = null

  function getFirstRow (row) {
    if (opts.header === true) return row
    if (_.isFunction(opts.header)) return opts.header(row)
  }

  function convertRow (row, firstRow) {
    const res = {}
    for (let i = 0, len = firstRow.length; i < len; i++) res[firstRow[i]] = row[i]
    return res
  }

  function drain (x, push, isEnd = false) {
    buffer = buffer + decoder.write(x)
    if ((buffer.endsWith(opts.quote) || buffer.endsWith('\r')) && !isEnd) return

    for (let c = 0, len = buffer.length; c < len; c++) {
      const cc = buffer[c]; const nc = buffer[c + 1]
      row[col] = row[col] || ''
      if (cc === opts.quote && quote && nc === opts.quote) { row[col] += cc; ++c; continue }
      if (cc === opts.quote) { quote = !quote; continue }
      if (cc === opts.separator && !quote) { ++col; continue }
      if (cc === '\r' && nc === '\n' && !quote) { ++c }
      if ((cc === '\n' || cc === '\r') && !quote) {
        if (!firstRow && opts.header) firstRow = getFirstRow(row)
        else push(null, opts.header ? convertRow(row, firstRow) : row)
        col = 0
        row = []
        continue
      }
      row[col] += cc
    }
    buffer = ''
  }

  if (Array.isArray(opts.header)) firstRow = opts.header

  return s.consume(function (err, x, push, next) {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      try {
        drain(decoder.end(), push, true)
      } catch (e) {
        push(e)
      }
      push(null, _.nil)
    } else {
      try {
        drain(x, push)
      } catch (e) {
        push(e)
      }
      next()
    }
  })
}
