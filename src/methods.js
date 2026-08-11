/*
  eslint-disable sonarjs/cognitive-complexity, complexity
*/

const _ = require('./utils.js')
const { Exstream, ExstreamError } = require('./exstream.js')
const { monotonicNow, scheduleNextTurn } = require('./scheduler.js')
const { aggregateContexts, assignContext, createContext, forkContext } = require('./context.js')
const { Transform } = require('stream')
const { StringDecoder } = require('string_decoder')

const _m = (module.exports = {})
const noCancel = () => undefined

const appendContext = (contexts, context, previousCount) => {
  if (context === void 0) {
    if (contexts) contexts.push(void 0)
    return contexts
  }
  if (!contexts) contexts = Array(previousCount)
  contexts.push(context)
  return contexts
}

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

_m.encode = _.curry((encoding, s) => {
  if (encoding !== 'base64') throw Error('.encode() supports only base64 at the moment')
  const decoder = new StringDecoder(encoding)
  return s.consumeSync((err, x, push) => {
    if (err) return push(err)
    try {
      const isNil = x === _.nil
      const str = isNil ? decoder.end() : decoder.write(Buffer.from(x))
      push(null, str)
      if (isNil) push(null, _.nil)
    } catch (e) {
      push(
        new ExstreamError(
          {
            message:
              'error in .encode(). expected string, Buffer, ' +
              'ArrayBuffer, Array, or Array-like Object. Got ' +
              typeof x,
          },
          x,
        ),
      )
    }
  })
})

_m.decode = _.curry((encoding, s) => {
  if (encoding !== 'base64') throw Error('.decode() supports only base64 at the moment')
  let buffer = ''
  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      if (buffer) push(null, Buffer.from(buffer, 'base64'))
      push(null, _.nil)
    } else {
      const toProcess = buffer + x
      const remaining = toProcess.length % 4
      const len = toProcess.length - remaining
      buffer = toProcess.slice(len)
      const validBase64 = toProcess.slice(0, len)
      if (validBase64) push(null, Buffer.from(validBase64, 'base64'))
    }
  })
})

_m.map = _.curry((fn, options, s) => {
  if (fn.length < 2)
    return s.consumeSync((err, x, push) => {
      if (err) {
        push(err)
      } else if (x === _.nil) {
        push(err, x)
      } else {
        try {
          let res = fn(x)
          const probablyPromise = res && res.then && res.catch
          if (probablyPromise)
            res = res.catch((e) => {
              throw new ExstreamError(e, x)
            })
          if (!options || !options.wrap) {
            return push(null, res)
          } else if (probablyPromise) {
            push(
              null,
              res.then((y) => ({ input: x, output: y })),
            )
          } else {
            push(null, { input: x, output: res })
          }
        } catch (e) {
          push(new ExstreamError(e, x))
        }
      }
    })
  let result
  result = s.consumeSync((err, x, push, context) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const nextContext = context === void 0 ? createContext(x, result.signal) : context
      try {
        let res = fn(x, nextContext)
        const probablyPromise = res && res.then && res.catch
        if (probablyPromise)
          res = res.catch((e) => {
            throw new ExstreamError(e, x)
          })
        if (!options || !options.wrap) {
          return push(null, res, nextContext)
        } else if (probablyPromise) {
          push(
            null,
            res.then((y) => ({ input: x, output: y })),
            nextContext,
          )
        } else {
          push(null, { input: x, output: res }, nextContext)
        }
      } catch (e) {
        push(new ExstreamError(e, x), null, nextContext)
      }
    }
  })
  return result
})

_m.withContext = _.curry((fn, s) => {
  let result
  result = s.consumeSync((err, x, push, context) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      const nextContext =
        context === void 0 ? createContext(x, result.signal) : forkContext(context, result.signal)
      try {
        assignContext(nextContext, fn ? fn(x, nextContext) : void 0)
        push(null, x, nextContext)
      } catch (e) {
        push(new ExstreamError(e, x), null, nextContext)
      }
    }
  })
  return result
})

_m.extendContext = _.curry((fn, s) => {
  let result
  result = s.consume(async (err, x, push, next, context) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      const nextContext = context === void 0 ? createContext(x, result.signal) : context
      try {
        assignContext(nextContext, await fn(x, nextContext))
        push(null, x, nextContext)
        next()
      } catch (e) {
        push(new ExstreamError(e, x), null, nextContext)
        next()
      }
    }
  })
  return result
})

_m.where = _.curry((props, s) =>
  s.filter((x) => {
    for (const p in props) {
      if (x[p] !== props[p]) return false
    }
    return true
  }),
)

_m.findWhere = _.curry((props, s) => s.where(props).take(1))

_m.ratelimit = _.curry((num, ms, s) => {
  num = _.asPositiveInteger(num)
  ms = _.asNonNegativeFiniteNumber(ms)
  if (num === null) throw Error('error in .ratelimit(). num must be a positive integer')
  if (ms === null) throw Error('error in .ratelimit(). ms must be a non-negative finite number')
  let sent = 0
  let startWindow
  let timer
  const result = s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(null, _.nil)
    } else if (sent === 0) {
      startWindow = monotonicNow()
      sent++
      push(null, x)
      next()
    } else if (sent < num) {
      sent++
      push(null, x)
      next()
    } else if (monotonicNow() - startWindow > ms) {
      startWindow = monotonicNow()
      sent = 1
      push(null, x)
      next()
    } else {
      timer = setTimeout(
        () => {
          startWindow = monotonicNow()
          sent = 1
          push(null, x)
          next()
        },
        ms - Math.round(monotonicNow() - startWindow),
      )
    }
  })
  result.once('end', () => {
    clearTimeout(timer)
    timer = void 0
  })
  return result
})

_m.throttle = _.curry((ms, s) => {
  ms = _.asNonNegativeFiniteNumber(ms)
  if (ms === null) throw Error('error in .throttle(). ms must be a non-negative finite number')
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

_m.collect = (s) => {
  const xs = []
  let contexts
  let result
  result = s.consumeSync((err, x, push, context) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(null, xs, contexts === void 0 ? void 0 : aggregateContexts(xs, contexts, result.signal))
      push(null, _.nil)
    } else {
      contexts = appendContext(contexts, context, xs.length)
      xs.push(x)
    }
  })
  return result
}

_m.flatten = (s) => {
  let result
  result = s.consumeSync((err, x, push, context) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else if (_.isIterable(x) && typeof x !== 'string') {
      if (context === void 0) {
        for (const y of x) push(null, y)
      } else {
        for (const y of x) push(null, y, forkContext(context, result.signal))
      }
    } else {
      push(null, x)
    }
  })
  return result
}

_m.flatMap = _.curry((fn, s) => s.map(fn).flatten())

_m.toArray = _.curry((fn, s) =>
  s.collect().pull((err, x) => {
    if (err) {
      ;(s.endOfChain || s).emit('error', err)
    } else {
      fn(x)
    }
  }),
)

_m.filter = _.curry((fn, s) => {
  if (fn.length < 2)
    return s.consumeSync((err, x, push) => {
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
    })
  let result
  result = s.consumeSync((err, x, push, context) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const nextContext = context === void 0 ? createContext(x, result.signal) : context
      try {
        const res = fn(x, nextContext)
        if (res) push(null, x, nextContext)
      } catch (e) {
        push(new ExstreamError(e, x), null, nextContext)
      }
    }
  })
  return result
})

_m.reject = _.curry((fn, s) => {
  const usesContext = fn.length >= 2
  let result
  result = s.consumeSync((err, x, push, context) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const nextContext =
        usesContext && context === void 0 ? createContext(x, result.signal) : context
      try {
        const res = usesContext ? fn(x, nextContext) : fn(x)
        if (!res) push(null, x, nextContext)
      } catch (e) {
        push(new ExstreamError(e, x), null, nextContext)
      }
    }
  })
  return result
})

_m.asyncFilter = _.curry((fn, s) => {
  const usesContext = fn.length >= 2
  let result
  result = s.consume(async (err, x, push, next, context) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const nextContext =
        usesContext && context === void 0 ? createContext(x, result.signal) : context
      try {
        const res = usesContext ? await fn(x, nextContext) : await fn(x)
        if (res) push(null, x, nextContext)
        next()
      } catch (e) {
        push(new ExstreamError(e, x), null, nextContext)
        next()
      }
    }
  })
  return result
})

_m.batch = _.curry((size, s) => {
  let buffer = []
  let contexts
  let result
  size = _.asPositiveInteger(size)
  if (size === null) throw Error('error in .batch(). size must be a valid number')
  const flush = (push) => {
    const batch = buffer
    push(
      null,
      batch,
      contexts === void 0 ? void 0 : aggregateContexts(batch, contexts, result.signal),
    )
    buffer = []
    contexts = void 0
  }
  result = s.consumeSync((err, x, push, context) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      if (buffer.length) flush(push)
      push(err, x)
    } else {
      contexts = appendContext(contexts, context, buffer.length)
      buffer.push(x)
      if (buffer.length >= size) flush(push)
    }
  })
  return result
})

_m.uniq = (s) => {
  const seen = new Set()
  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else if (!seen.has(x)) {
      seen.add(x)
      push(null, x)
    }
  })
}

_m.pluck = _.curry((field, defaultValue, s) => {
  if (typeof field !== 'string') {
    throw new ExstreamError(Error('error in .pluck(). expected string, got ' + typeof x))
  }
  const getter = _.makeGetter(field, defaultValue)
  return s.map(getter)
})

_m.pick = _.curry((fields, s) =>
  s.map((x) => {
    const res = {}
    let hasKey
    for (let i = 0, len = fields.length; i < len; i++) {
      try {
        hasKey = fields[i] in x
      } catch (e) {
        throw new ExstreamError(Error('error in .pick(). expected object, got ' + typeof x), x)
      }
      if (hasKey) res[fields[i]] = x[fields[i]]
    }
    return res
  }),
)

_m.omit = _.curry((fields, s) =>
  s.map((x) => {
    const res = { ...x }
    fields = Array.isArray(fields) ? fields : [fields]
    let hasKey
    for (let i = 0, len = fields.length; i < len; i++) {
      try {
        hasKey = fields[i] in x
      } catch (e) {
        throw new ExstreamError(Error('error in .omit(). expected object, got ' + typeof x), x)
      }
      if (hasKey) delete res[fields[i]]
    }
    return res
  }),
)

_m.uniqBy = _.curry((cfg, s) => {
  const seen = new Set()
  const seenComposite = new Map()
  const compositeLeaf = Symbol('uniqBy composite leaf')
  const isFn = _.isFunction(cfg)
  if (!isFn && !Array.isArray(cfg)) cfg = [cfg]

  const fn = !isFn ? (x) => cfg.map((f) => x[f]) : cfg

  function hasSeenCompositeKey(key) {
    let level = seenComposite
    for (const part of key) {
      if (!level.has(part)) level.set(part, new Map())
      level = level.get(part)
    }
    if (level.has(compositeLeaf)) return true
    level.set(compositeLeaf, true)
    return false
  }

  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      try {
        const k = fn(x)
        const alreadySeen = isFn ? seen.has(k) : hasSeenCompositeKey(k)
        if (!alreadySeen) {
          if (isFn) seen.add(k)
          push(null, x)
        }
      } catch (e) {
        push(new ExstreamError(e, x))
      }
    }
  })
})

_m.massThen = _.curry((fn, s) =>
  fn.length >= 2
    ? s.map((x, context) => x.then((value) => fn(value, context)))
    : s.map((x) => x.then(fn)),
)

_m.massCatch = _.curry((fn, s) =>
  fn.length >= 2
    ? s.map((x, context) => x.catch((error) => fn(error, context)))
    : s.map((x) => x.catch(fn)),
)

_m.resolve = _.curry((parallelism, preserveOrder, s) => {
  parallelism = _.asPositiveInteger(parallelism, true)
  if (parallelism === null) {
    throw Error('error in .resolve(). parallelism must be a positive integer or Infinity')
  }
  const promises = []
  let ended = false
  let result

  function handlePromiseResult(isError, res, resPointer, push, next) {
    if (result.ended) {
      promises.splice(promises.indexOf(resPointer), 1)
      return
    }
    if (isError && res.exstreamFatal) {
      result.fail(res, res.exstreamInput)
      return
    }
    resPointer.result = res
    resPointer.isError = isError
    const idx = promises.indexOf(resPointer)

    if (preserveOrder) {
      while (_.has(promises[0], 'result')) {
        const item = promises.shift()
        if (item.isError) item.push(item.result)
        else item.push(null, item.result)
      }
    } else {
      promises.splice(idx, 1)
      if (isError) push(res)
      else push(null, res)
    }

    if (ended && promises.length === 0) push(null, _.nil)
    else if (!preserveOrder || idx === 0) next()
  }

  result = s.consume((err, el, push, next) => {
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
      const resPointer = { push }
      promises.push(resPointer)
      el.then((res) => handlePromiseResult(false, res, resPointer, push, next)).catch((res) => {
        handlePromiseResult(true, new ExstreamError(res, el), resPointer, push, next)
      })
      if (promises.length < parallelism) next()
    }
  })
  return result
})

_m.errors = _.curry((fn, s) =>
  s.consumeSync((err, x, push, context) => {
    if (x === _.nil) {
      push(null, _.nil)
    } else if (err) {
      if (fn.length >= 3) fn(err, push, context)
      else fn(err, push)
    } else {
      push(null, x)
    }
  }),
)

_m.stopOnError = _.curry((fn, s) => {
  const s1 = s.consumeSync((err, x, push, context) => {
    if (x === _.nil) {
      push(null, _.nil)
    } else if (err) {
      if (fn.length >= 3) fn(err, push, context)
      else fn(err, push)
      s1.destroy()
    } else {
      push(null, x)
    }
  })
  return s1
})

_m.stopWhen = _.curry((fn, s) => {
  const s1 = s.consumeSync((err, x, push) => {
    if (x === _.nil) {
      push(null, _.nil)
    } else if (err) {
      push(err)
    } else {
      push(null, x)
      if (fn(x)) s1.destroy()
    }
  })
  return s1
})

_m.toPromise = (s) =>
  new Promise((resolve, reject) =>
    s.once('error', reject).toArray((res) => {
      s.off('error', reject)
      resolve(res)
    }),
  )

_m.toNodeStream = _.curry((options, s) =>
  s.pipe(
    new Transform({
      objectMode: true,
      transform: function (chunk, enc, cb) {
        this.push(chunk)
        cb()
      },
      ...options,
    }),
  ),
)

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
  let contexts
  let inputCount = 0
  let s1
  s1 = s.consumeSync((err, x, push, context) => {
    if (x === _.nil) {
      push(
        null,
        accumulator,
        contexts === void 0 ? void 0 : aggregateContexts(accumulator, contexts, s1.signal),
      )
      push(null, _.nil)
    } else if (err) {
      push(err)
    } else {
      const nextContext =
        context === void 0 && fn.length >= 3 ? createContext(x, s1.signal) : context
      contexts = appendContext(contexts, nextContext, inputCount++)
      try {
        accumulator = fn.length >= 3 ? fn(accumulator, x, nextContext) : fn(accumulator, x)
      } catch (e) {
        try {
          push(new ExstreamError(e, x), null, nextContext)
        } finally {
          accumulator = void 0
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
  let contexts
  let inputCount = 0
  let s1
  s1 = s.consumeSync((err, x, push, context) => {
    if (x === _.nil) {
      push(
        null,
        accumulator,
        contexts === void 0 ? void 0 : aggregateContexts(accumulator, contexts, s1.signal),
      )
      push(null, _.nil)
    } else if (err) {
      push(err)
    } else {
      const nextContext =
        context === void 0 && fn.length >= 3 ? createContext(x, s1.signal) : context
      contexts = appendContext(contexts, nextContext, inputCount++)
      if (!init) {
        init = true
        accumulator = x
        return
      }
      try {
        accumulator = fn.length >= 3 ? fn(accumulator, x, nextContext) : fn(accumulator, x)
      } catch (e) {
        try {
          push(new ExstreamError(e, x), null, nextContext)
        } finally {
          accumulator = void 0
          s1.destroy()
        }
      }
    }
  })
  return s1
})

_m.asyncReduce = _.curry((fn, accumulator, s) => {
  let contexts
  let inputCount = 0
  let s1
  s1 = s.consume(async (err, x, push, next, context) => {
    if (x === _.nil) {
      push(
        null,
        accumulator,
        contexts === void 0 ? void 0 : aggregateContexts(accumulator, contexts, s1.signal),
      )
      push(null, _.nil)
    } else if (err) {
      push(err)
      next()
    } else {
      const nextContext =
        context === void 0 && fn.length >= 3 ? createContext(x, s1.signal) : context
      contexts = appendContext(contexts, nextContext, inputCount++)
      try {
        accumulator =
          fn.length >= 3 ? await fn(accumulator, x, nextContext) : await fn(accumulator, x)
        next()
      } catch (e) {
        try {
          push(new ExstreamError(e, x), null, nextContext)
        } finally {
          accumulator = void 0
          s1.destroy()
        }
      }
    }
  })
  return s1
})

_m.groupBy = _.curry((fnOrString, s) => {
  const getter = _.isString(fnOrString) ? _.makeGetter(fnOrString, _.nil) : fnOrString
  return s.reduce((accumulator, x) => {
    let key = getter(x)
    if (key === null || key === void 0) key = _.nil
    if (!_.has(accumulator, key)) accumulator[key] = []
    accumulator[key].push(x)
    return accumulator
  }, {})
})

_m.keyBy = _.curry((fnOrString, s) => {
  const getter = _.isString(fnOrString) ? _.makeGetter(fnOrString, _.nil) : fnOrString
  return s.reduce((accumulator, x) => {
    let key = getter(x)
    if (key === null || key === void 0) key = _.nil
    const keyAlreadyExists = _.has(accumulator, key)
    if (keyAlreadyExists) throw new ExstreamError(`Multiple values per key: ${key}`, x)
    accumulator[key] = x
    return accumulator
  }, {})
})

_m.sortBy = _.curry((fn, s) =>
  s
    .collect()
    .map((x) => x.sort(fn))
    .flatten(),
)

_m.sort = (s) => _m.sortBy(void 0, s)

_m.makeAsync = _.curry((maxSyncExecutionTime, s) => {
  maxSyncExecutionTime = _.asNonNegativeFiniteNumber(maxSyncExecutionTime)
  if (maxSyncExecutionTime === null) {
    throw Error('error in .makeAsync(). maxSyncExecutionTime must be a non-negative finite number')
  }
  let lastSnapshot = null
  let start = null
  let end = null
  let cancelTurn = noCancel
  const result = s.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      lastSnapshot = monotonicNow()
      if (start === null) start = lastSnapshot
      else end = lastSnapshot
      if (end !== null && end - start > maxSyncExecutionTime) {
        cancelTurn = scheduleNextTurn(() => {
          cancelTurn = noCancel
          push(null, x)
          start = monotonicNow()
          next()
        })
      } else {
        push(null, x)
        next()
      }
    }
  })
  result.once('end', () => {
    cancelTurn()
    cancelTurn = noCancel
  })
  return result
})

_m.tap = _.curry((fn, s) =>
  fn.length >= 2
    ? s.map((x, context) => {
        fn(x, context)
        return x
      })
    : s.map((x) => {
        fn(x)
        return x
      }),
)

_m.compact = (s) => s.filter((x) => x)

_m.find = _.curry((fn, s) => s.filter(fn).take(1))

_m.head = (s) => s.take(1)

_m.last = (s) => {
  const nothing = {}
  let last = nothing
  return s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      if (last !== nothing) push(null, last)
      push(null, _.nil)
    } else {
      last = x
    }
  })
}

_m.pipeline = () =>
  new Proxy(
    {
      __exstream_pipeline__: true, // eslint-disable-line camelcase
      definitions: [],
      generateStream: function () {
        const s = new Exstream()
        let curr = s
        for (const { method, args } of this.definitions) curr = curr[method](...args)
        s.endOfChain = curr.endOfChain || curr
        return s
      },
    },
    {
      get(target, propKey, receiver) {
        if (target[propKey] || !Exstream.prototype[propKey]) {
          return Reflect.get(target, propKey, receiver)
        }
        return (...args) => {
          target.definitions.push({ method: propKey, args })
          return receiver
        }
      },
    },
  )