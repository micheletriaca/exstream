const _ = require('./utils.js')
const { Exstream, ExstreamError } = require('./exstream.js')
const { monotonicNow, scheduleMicrotask, scheduleNextTurn } = require('./scheduler.js')
const {
  aggregateContexts,
  appendContext,
  assignContext,
  createContext,
  forkContext,
  setContextSignal,
} = require('./context.js')
const { runtime } = require('./runtime.js')

const _m = (module.exports = {})
const noCancel = () => undefined

_m.split = _.curry((encoding, s) => _m.splitBy(/\r?\n/, encoding, s))

_m.splitBy = _.curry((regexp, encoding, s) => {
  const decoder = runtime.createStringDecoder(encoding)
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
  const decoder = runtime.createBase64Encoder()
  return s.consumeSync((err, x, push) => {
    if (err) return push(err)
    try {
      const isNil = x === _.nil
      const str = isNil ? decoder.end() : decoder.write(runtime.bytesFrom(x))
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
      if (buffer) push(null, runtime.decodeBase64(buffer))
      push(null, _.nil)
    } else {
      const toProcess = buffer + x
      const remaining = toProcess.length % 4
      const len = toProcess.length - remaining
      buffer = toProcess.slice(len)
      const validBase64 = toProcess.slice(0, len)
      if (validBase64) push(null, runtime.decodeBase64(validBase64))
    }
  })
})

_m.map = _.curry((fn, options, s) => {
  const usesContext = fn.length >= 2
  let result
  const consumer = (err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const context = usesContext ? result._recordContext : void 0
      const nextContext =
        usesContext && context === void 0 ? createContext(x, result.signal) : context
      try {
        let res = usesContext ? fn(x, nextContext) : fn(x)
        const probablyPromise = res && res.then && res.catch
        if (probablyPromise)
          res = res.catch((e) => {
            throw new ExstreamError(e, x, { origin: 'operator', stage: 'map' })
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
        push(new ExstreamError(e, x, { origin: 'operator', stage: 'map' }), null, nextContext)
      }
    }
  }
  result = s.consumeSync(consumer)
  return result
})

_m.withContext = _.curry((fn, s) => {
  let result
  result = s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      const context = result._recordContext
      const nextContext =
        context === void 0 ? createContext(x, result.signal) : forkContext(context, result.signal)
      try {
        assignContext(nextContext, fn ? fn(x, nextContext) : void 0)
        push(null, x, nextContext)
      } catch (e) {
        push(
          new ExstreamError(e, x, { origin: 'operator', stage: 'withContext' }),
          null,
          nextContext,
        )
      }
    }
  })
  return result
})

_m.extendContext = _.curry((fn, s) => {
  let result
  result = s.consume(async (err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(null, _.nil)
    } else {
      const context = result._recordContext
      const nextContext = context === void 0 ? createContext(x, result.signal) : context
      try {
        assignContext(nextContext, await fn(x, nextContext))
        push(null, x, nextContext)
        next()
      } catch (e) {
        push(
          new ExstreamError(e, x, { origin: 'operator', stage: 'extendContext' }),
          null,
          nextContext,
        )
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
    const now = monotonicNow()
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
  result = s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(null, xs, contexts === void 0 ? void 0 : aggregateContexts(xs, contexts, result.signal))
      push(null, _.nil)
    } else {
      const context = result._recordContext
      contexts = appendContext(contexts, context, xs.length)
      xs.push(x)
    }
  })
  return result
}

_m.flatten = (s) => {
  let result
  result = s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else if (_.isIterable(x) && typeof x !== 'string') {
      const context = result._recordContext
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

_m.filter = _.curry((fn, s) => {
  const usesContext = fn.length >= 2
  let result
  const consumer = (err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const context = usesContext ? result._recordContext : void 0
      const nextContext =
        usesContext && context === void 0 ? createContext(x, result.signal) : context
      try {
        const res = usesContext ? fn(x, nextContext) : fn(x)
        if (res) push(null, x, nextContext)
      } catch (e) {
        push(new ExstreamError(e, x, { origin: 'operator', stage: 'filter' }), null, nextContext)
      }
    }
  }
  result = s.consumeSync(consumer)
  return result
})

_m.reject = _.curry((fn, s) => {
  const usesContext = fn.length >= 2
  let result
  result = s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const context = usesContext ? result._recordContext : void 0
      const nextContext =
        usesContext && context === void 0 ? createContext(x, result.signal) : context
      try {
        const res = usesContext ? fn(x, nextContext) : fn(x)
        if (!res) push(null, x, nextContext)
      } catch (e) {
        push(new ExstreamError(e, x, { origin: 'operator', stage: 'reject' }), null, nextContext)
      }
    }
  })
  return result
})

_m.asyncFilter = _.curry((fn, s) => {
  const usesContext = fn.length >= 2
  let result
  result = s.consume(async (err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const context = usesContext ? result._recordContext : void 0
      const nextContext =
        usesContext && context === void 0 ? createContext(x, result.signal) : context
      try {
        let res
        if (usesContext) res = await fn(x, nextContext)
        else res = await fn(x)
        if (res) push(null, x, nextContext)
        next()
      } catch (e) {
        push(
          new ExstreamError(e, x, { origin: 'operator', stage: 'asyncFilter' }),
          null,
          nextContext,
        )
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
  result = s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      if (buffer.length) flush(push)
      push(err, x)
    } else {
      const context = result._recordContext
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
  const usesContext = isFn && fn.length >= 2
  let result

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

  result = s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      push(err, x)
    } else {
      const context = usesContext ? result._recordContext : void 0
      const nextContext =
        usesContext && context === void 0 ? createContext(x, result.signal) : context
      try {
        const k = usesContext ? fn(x, nextContext) : fn(x)
        const alreadySeen = isFn ? seen.has(k) : hasSeenCompositeKey(k)
        if (!alreadySeen) {
          if (isFn) seen.add(k)
          push(null, x, nextContext)
        }
      } catch (e) {
        push(new ExstreamError(e, x), null, nextContext)
      }
    }
  })
  return result
})

class MapAsyncTimeoutError extends Error {
  constructor(timeout, attempt) {
    super(`mapAsync attempt ${attempt} timed out after ${timeout} ms`)
    this.name = 'MapAsyncTimeoutError'
    this.code = 'EXSTREAM_MAP_ASYNC_TIMEOUT'
    this.timeout = timeout
    this.attempt = attempt
  }
}

_m.MapAsyncTimeoutError = MapAsyncTimeoutError

const asNonNegativeInteger = (value) => {
  let number
  try {
    number = Number(value)
  } catch {
    return null
  }
  return Number.isInteger(number) && number >= 0 ? number : null
}

const normalizeMapAsyncRetry = (retry) => {
  if (retry === void 0 || retry === null) return { delay: 0, retries: 0, when: null }
  if (typeof retry !== 'object' || Array.isArray(retry)) {
    const retries = asNonNegativeInteger(retry)
    if (retries === null) {
      throw Error('error in .mapAsync(). retry must be a non-negative integer or an object')
    }
    return { delay: 0, retries, when: null }
  }
  const retries = asNonNegativeInteger(retry.retries === void 0 ? 0 : retry.retries)
  if (retries === null) {
    throw Error('error in .mapAsync(). retry.retries must be a non-negative integer')
  }
  const when = retry.when === void 0 ? null : retry.when
  if (when !== null && !_.isFunction(when)) {
    throw Error('error in .mapAsync(). retry.when must be a function')
  }
  const delay = retry.delay === void 0 ? 0 : retry.delay
  if (!_.isFunction(delay) && _.asNonNegativeFiniteNumber(delay) === null) {
    throw Error('error in .mapAsync(). retry.delay must be a non-negative number or a function')
  }
  return { delay, retries, when }
}

const normalizeMapAsyncTimeout = (timeout) => {
  if (timeout === void 0 || timeout === null) return null
  timeout = _.asNonNegativeFiniteNumber(timeout)
  if (timeout === null) {
    throw Error('error in .mapAsync(). timeout must be a non-negative finite number')
  }
  return timeout
}

const abortableDelay = (ms, signal) => {
  return new Promise((resolve, reject) => {
    let timer
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      reject(signal.reason)
    }
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

const createAttemptTimeoutCoordinator = () => {
  const attempts = new Set()
  let closed = false
  let scheduledDeadline = Infinity
  let timer

  const schedule = () => {
    if (closed || timer) return
    let deadline = Infinity
    for (const attempt of attempts) deadline = Math.min(deadline, attempt.deadline)
    if (deadline === Infinity) return
    scheduledDeadline = deadline
    timer = setTimeout(expire, Math.max(0, deadline - monotonicNow()))
  }

  const expire = () => {
    timer = void 0
    scheduledDeadline = Infinity
    const now = monotonicNow()
    for (const attempt of attempts) {
      if (attempt.deadline <= now) {
        attempts.delete(attempt)
        attempt.expire()
      }
    }
    schedule()
  }

  const add = (timeout, expireAttempt) => {
    const attempt = { deadline: monotonicNow() + timeout, expire: expireAttempt }
    attempts.add(attempt)
    if (attempt.deadline < scheduledDeadline) {
      clearTimeout(timer)
      timer = void 0
    }
    schedule()
    return () => attempts.delete(attempt)
  }

  const close = () => {
    closed = true
    clearTimeout(timer)
    timer = void 0
    attempts.clear()
  }

  return { add, close }
}

const runMapAsyncAttempt = async ({
  attempt,
  baseSignal,
  context,
  fn,
  timeout,
  timeoutCoordinator,
  usesContext,
  value,
}) => {
  if (baseSignal.aborted) throw baseSignal.reason
  if (timeout === null) return usesContext ? fn(value, context) : fn(value)

  if (context === void 0) {
    let removeTimeout = noCancel
    try {
      return await new Promise((resolve, reject) => {
        removeTimeout = timeoutCoordinator.add(timeout, () => {
          reject(new MapAsyncTimeoutError(timeout, attempt))
        })
        Promise.resolve()
          .then(() => fn(value))
          .then(resolve, reject)
      })
    } finally {
      removeTimeout()
    }
  }

  const controller = new AbortController()
  const forwardAbort = () => controller.abort(baseSignal.reason)
  baseSignal.addEventListener('abort', forwardAbort, { once: true })
  setContextSignal(context, controller.signal)
  let removeTimeout = noCancel
  try {
    return await new Promise((resolve, reject) => {
      removeTimeout = timeoutCoordinator.add(timeout, () => {
        const timeoutError = new MapAsyncTimeoutError(timeout, attempt)
        controller.abort(timeoutError)
        reject(timeoutError)
      })
      Promise.resolve()
        .then(() => (usesContext ? fn(value, context) : fn(value)))
        .then(resolve, reject)
    })
  } finally {
    removeTimeout()
    baseSignal.removeEventListener('abort', forwardAbort)
    setContextSignal(context, baseSignal)
  }
}

// Sequential awaits are the retry state machine; each attempt must finish before the next starts.
/* oxlint-disable no-await-in-loop */
const runMapAsyncTask = async (
  value,
  context,
  result,
  fn,
  usesContext,
  retry,
  timeout,
  timeoutCoordinator,
) => {
  const baseSignal = context === void 0 ? result.signal : context.signal
  let attempt = 0
  while (true) {
    attempt++
    try {
      return await runMapAsyncAttempt({
        attempt,
        baseSignal,
        context,
        fn,
        timeout,
        timeoutCoordinator,
        usesContext,
        value,
      })
    } catch (reason) {
      const error = new ExstreamError(reason, value)
      if (error.exstreamFatal || attempt > retry.retries) throw error
      if (retry.when && !(await retry.when(error, value, context, attempt))) throw error
      const delay = _.isFunction(retry.delay)
        ? await retry.delay(attempt, error, value, context)
        : retry.delay
      const delayMs = _.asNonNegativeFiniteNumber(delay)
      if (delayMs === null) {
        error.message = 'error in .mapAsync(). retry.delay returned an invalid delay'
        throw error
      }
      if (baseSignal.aborted) throw baseSignal.reason
      if (delayMs > 0) await abortableDelay(delayMs, baseSignal)
    }
  }
}
/* oxlint-enable no-await-in-loop */

const validateMapAsyncSignal = (signal) => {
  if (signal === void 0) return
  if (
    !signal ||
    typeof signal.aborted !== 'boolean' ||
    typeof signal.addEventListener !== 'function' ||
    typeof signal.removeEventListener !== 'function'
  ) {
    throw Error('error in .mapAsync(). signal must be an AbortSignal')
  }
}

const linkAbortSignal = (result, signal) => {
  if (signal === void 0) return
  const abort = () => result.abort(signal.reason)
  const cleanup = () => signal.removeEventListener('abort', abort)
  result.once('end', cleanup)
  if (signal.aborted) {
    result.pause(true)
    scheduleMicrotask(abort)
  } else {
    signal.addEventListener('abort', abort, { once: true })
  }
}

const slidingConcurrentTransform = (s, options) => {
  const { concurrency, createTask, ordered, signal } = options
  const tasks = []
  const readyTasks = []
  let sourceEnded = false
  let outputNext = null
  let started = false
  let sink
  let result

  const hasReadyTask = () => (ordered ? tasks[0]?.settled === true : readyTasks.length > 0)

  const takeReadyTask = () => {
    const task = ordered ? tasks.shift() : readyTasks.shift()
    if (!ordered) tasks.splice(tasks.indexOf(task), 1)
    return task
  }

  const wakeOutput = () => {
    if (!outputNext) return
    if (!hasReadyTask() && !(sourceEnded && tasks.length === 0)) return
    const next = outputNext
    outputNext = null
    next()
  }

  const handleTaskResult = (isError, value, task) => {
    if (result.ended) {
      tasks.splice(tasks.indexOf(task), 1)
      return
    }
    if (isError && value.exstreamFatal) {
      result.fail(value, value.exstreamInput)
      return
    }
    task.error = isError ? value : null
    task.result = value
    task.settled = true
    if (!ordered) readyTasks.push(task)
    wakeOutput()
  }

  result = new Exstream((write, next) => {
    if (!started) {
      started = true
      sink.resume()
    }

    if (hasReadyTask()) {
      const task = takeReadyTask()
      if (task.error) result._writeError(task.error, task.context)
      else result._writeData(task.result, false, task.context)
      task.next()
      next()
    } else if (sourceEnded && tasks.length === 0) {
      write(_.nil)
    } else {
      outputNext = next
    }
  })

  sink = s.consume((error, value, push, next) => {
    if (result.ended) return
    if (error) {
      const task = {
        context: sink._recordContext,
        error,
        next,
        settled: true,
      }
      tasks.push(task)
      if (!ordered) readyTasks.push(task)
      if (tasks.length < concurrency) next()
      wakeOutput()
    } else if (value === _.nil) {
      sourceEnded = true
      push(null, _.nil)
      wakeOutput()
    } else {
      let context = sink._recordContext
      const taskResult = createTask(value, context, result)
      context = taskResult.context
      const task = { context, next, settled: false }
      tasks.push(task)
      Promise.resolve(taskResult.value)
        .then((resolved) => handleTaskResult(false, resolved, task))
        .catch((reason) => handleTaskResult(true, new ExstreamError(reason, value), task))
      if (tasks.length < concurrency) next()
    }
  })

  result.once('abort', (reason) => {
    sink.abort(reason)
  })
  result.once('end', () => {
    outputNext = null
    if (!sink.ended) sink.destroy()
  })
  sink.once('abort', (reason) => {
    if (!result.ended) result.abort(reason)
  })
  linkAbortSignal(result, signal)
  return result
}

_m.mapAsync = _.curry((fn, options, s) => {
  if (!_.isFunction(fn)) throw Error('error in .mapAsync(). fn must be a function')
  if (options === null || options === void 0) options = {}
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw Error('error in .mapAsync(). options must be an object')
  }
  const concurrency = _.asPositiveInteger(
    options.concurrency === void 0 ? 1 : options.concurrency,
    true,
  )
  if (concurrency === null) {
    throw Error('error in .mapAsync(). concurrency must be a positive integer or Infinity')
  }
  const ordered = options.ordered === void 0 ? true : options.ordered
  if (typeof ordered !== 'boolean') {
    throw Error('error in .mapAsync(). ordered must be a boolean')
  }
  validateMapAsyncSignal(options.signal)
  const retry = normalizeMapAsyncRetry(options.retry)
  const timeout = normalizeMapAsyncTimeout(options.timeout)
  const usesContext = fn.length >= 2
  const needsContext =
    usesContext ||
    (retry.when && retry.when.length >= 3) ||
    (_.isFunction(retry.delay) && retry.delay.length >= 4)
  const hasTaskPolicy = retry.retries > 0 || timeout !== null
  const timeoutCoordinator = timeout === null ? null : createAttemptTimeoutCoordinator()
  const result = slidingConcurrentTransform(s, {
    concurrency,
    createTask: (value, context, result) => {
      if (needsContext && context === void 0) context = createContext(value, result.signal)
      if (!hasTaskPolicy) {
        try {
          return { context, value: usesContext ? fn(value, context) : fn(value) }
        } catch (reason) {
          return { context, value: Promise.reject(new ExstreamError(reason, value)) }
        }
      }
      return {
        context,
        value: runMapAsyncTask(
          value,
          context,
          result,
          fn,
          usesContext,
          retry,
          timeout,
          timeoutCoordinator,
        ),
      }
    },
    ordered,
    signal: options.signal,
  })
  if (timeoutCoordinator) result.once('end', timeoutCoordinator.close)
  return result
})

_m.errors = _.curry((fn, s) => {
  const usesContext = fn.length >= 3
  let result
  result = s.consumeSync((err, x, push) => {
    if (x === _.nil) {
      push(null, _.nil)
    } else if (err) {
      if (!usesContext) {
        fn(err, push)
      } else {
        const context = result._recordContext
        if (context !== void 0) {
          fn(err, push, context)
        } else {
          const nextContext = createContext(err.exstreamInput, result.signal)
          const contextualPush = (error, value, outputContext = nextContext) =>
            push(error, value, outputContext)
          fn(err, contextualPush, nextContext)
        }
      }
    } else {
      push(null, x)
    }
  })
  return result
})

_m.skipErrors = _.curry((predicate, s) => {
  const usesInput = predicate && predicate.length >= 2
  const usesContext = predicate && predicate.length >= 3
  let result
  result = s.consumeSync((err, x, push) => {
    if (x === _.nil) {
      push(null, _.nil)
    } else if (!err) {
      push(null, x)
    } else if (!predicate) {
      return
    } else {
      const input = err.exstreamInput
      let context = usesContext ? result._recordContext : void 0
      if (usesContext && context === void 0) context = createContext(input, result.signal)
      try {
        const skip = usesContext
          ? predicate(err, input, context)
          : usesInput
            ? predicate(err, input)
            : predicate(err)
        if (!skip) push(err, null, context)
      } catch (error) {
        push(new ExstreamError(error, input), null, context)
      }
    }
  })
  return result
})

_m.failOnError = (s) => {
  let result
  result = s.consumeSync((err, x, push) => {
    if (x === _.nil) {
      push(null, _.nil)
    } else if (err) {
      result.fail(err, err.exstreamInput)
    } else {
      push(null, x)
    }
  })
  return result
}

_m.routeErrors = (s) => {
  const output = s.fork().skipErrors()
  let deadLetters
  deadLetters = s.fork().consumeSync((error, value, push) => {
    if (value === _.nil) {
      push(null, _.nil)
    } else if (error) {
      const input = error.exstreamInput
      const currentContext = deadLetters._recordContext
      const context =
        currentContext === void 0 ? createContext(input, deadLetters.signal) : currentContext
      push(null, { error, input }, context)
    }
  })
  return { deadLetters, output }
}

_m.stopOnError = _.curry((fn, s) => {
  const usesContext = fn.length >= 3
  let s1
  s1 = s.consumeSync((err, x, push) => {
    if (x === _.nil) {
      push(null, _.nil)
    } else if (err) {
      if (!usesContext) {
        fn(err, push)
      } else {
        const context = s1._recordContext
        if (context !== void 0) {
          fn(err, push, context)
        } else {
          const nextContext = createContext(err.exstreamInput, s1.signal)
          const contextualPush = (error, value, outputContext = nextContext) =>
            push(error, value, outputContext)
          fn(err, contextualPush, nextContext)
        }
      }
      s1.destroy()
    } else {
      push(null, x)
    }
  })
  return s1
})

_m.stopWhen = _.curry((fn, s) => {
  const usesContext = fn.length >= 2
  let s1
  s1 = s.consumeSync((err, x, push) => {
    if (x === _.nil) {
      push(null, _.nil)
    } else if (err) {
      push(err)
    } else {
      const context = usesContext ? s1._recordContext : void 0
      const nextContext = usesContext && context === void 0 ? createContext(x, s1.signal) : context
      push(null, x, nextContext)
      if (usesContext ? fn(x, nextContext) : fn(x)) s1.destroy()
    }
  })
  return s1
})

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
  const usesContext = fn.length >= 3
  let contexts
  let inputCount = 0
  let s1
  s1 = s.consumeSync((err, x, push) => {
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
      const context = s1._recordContext
      const nextContext = context === void 0 && usesContext ? createContext(x, s1.signal) : context
      contexts = appendContext(contexts, nextContext, inputCount++)
      try {
        accumulator = usesContext ? fn(accumulator, x, nextContext) : fn(accumulator, x)
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
  const usesContext = fn.length >= 3
  let init = false
  let accumulator
  let contexts
  let inputCount = 0
  let s1
  s1 = s.consumeSync((err, x, push) => {
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
      const context = s1._recordContext
      const nextContext = context === void 0 && usesContext ? createContext(x, s1.signal) : context
      contexts = appendContext(contexts, nextContext, inputCount++)
      if (!init) {
        init = true
        accumulator = x
        return
      }
      try {
        accumulator = usesContext ? fn(accumulator, x, nextContext) : fn(accumulator, x)
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
  const usesContext = fn.length >= 3
  let contexts
  let inputCount = 0
  let s1
  s1 = s.consume(async (err, x, push, next) => {
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
      const context = s1._recordContext
      const nextContext = context === void 0 && usesContext ? createContext(x, s1.signal) : context
      contexts = appendContext(contexts, nextContext, inputCount++)
      try {
        accumulator = usesContext ? await fn(accumulator, x, nextContext) : await fn(accumulator, x)
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
  const usesContext = !_.isString(fnOrString) && getter.length >= 2
  const add = (accumulator, x, context) => {
    let key = usesContext ? getter(x, context) : getter(x)
    if (key === null || key === void 0) key = _.nil
    if (!_.has(accumulator, key)) accumulator[key] = []
    accumulator[key].push(x)
    return accumulator
  }
  return usesContext
    ? s.reduce((accumulator, x, context) => add(accumulator, x, context), {})
    : s.reduce((accumulator, x) => add(accumulator, x), {})
})

_m.keyBy = _.curry((fnOrString, s) => {
  const getter = _.isString(fnOrString) ? _.makeGetter(fnOrString, _.nil) : fnOrString
  const usesContext = !_.isString(fnOrString) && getter.length >= 2
  const add = (accumulator, x, context) => {
    let key = usesContext ? getter(x, context) : getter(x)
    if (key === null || key === void 0) key = _.nil
    const keyAlreadyExists = _.has(accumulator, key)
    if (keyAlreadyExists) throw new ExstreamError(`Multiple values per key: ${key}`, x)
    accumulator[key] = x
    return accumulator
  }
  return usesContext
    ? s.reduce((accumulator, x, context) => add(accumulator, x, context), {})
    : s.reduce((accumulator, x) => add(accumulator, x), {})
})

_m.sortBy = _.curry((fn, s) => {
  const usesContext = fn && fn.length >= 3
  const entries = []
  let result
  result = s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      const values = entries.map((entry) => entry.value)
      try {
        entries.sort((left, right) => {
          if (!fn) {
            if (left.value === void 0) return right.value === void 0 ? 0 : 1
            if (right.value === void 0) return -1
            if (typeof left.value === 'symbol' || typeof right.value === 'symbol') {
              throw TypeError('Cannot convert a Symbol value to a string')
            }
            const leftValue = String(left.value)
            const rightValue = String(right.value)
            return leftValue < rightValue ? -1 : Number(leftValue > rightValue)
          }
          if (usesContext) return fn(left.value, right.value, left.context, right.context)
          return fn(left.value, right.value)
        })
        for (const entry of entries) push(null, entry.value, entry.context)
      } catch (error) {
        let contexts
        for (let index = 0; index < entries.length; index++) {
          contexts = appendContext(contexts, entries[index].context, index)
        }
        push(
          new ExstreamError(error, values),
          null,
          contexts === void 0 ? void 0 : aggregateContexts(values, contexts, result.signal),
        )
      }
      push(null, _.nil)
    } else {
      let context = result._recordContext
      if (usesContext && context === void 0) context = createContext(x, result.signal)
      entries.push({ context, value: x })
    }
  })
  return result
})

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
  let lastContext
  let result
  result = s.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      if (last !== nothing) push(null, last, lastContext)
      push(null, _.nil)
    } else {
      last = x
      lastContext = result._recordContext
    }
  })
  return result
}

_m.pipeline = () =>
  new Proxy(
    {
      __exstream_pipeline__: true,
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