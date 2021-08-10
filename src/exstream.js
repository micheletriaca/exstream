const EventEmitter = require('events').EventEmitter
const { Readable, Transform } = require('stream')

class Exstream extends EventEmitter {
  __exstream__ = true
  writable = true

  paused = true
  #nilPushed = false

  #buffer = []
  #sourceData = null
  #generator = null

  consumeFn = null
  #consumers = []

  constructor (xs) {
    super()
    if (!xs) return this
    else if (_.isExstream(xs)) return xs
    else if (_.isIterable(xs)) this.#sourceData = xs[Symbol.iterator]()
    else if (_.isReadableStream(xs)) xs.pipe(this)
    else if (_.isAsyncIterable(xs)) Readable.from(xs).pipe(this)
    else if (_.isPromise(xs)) return _([xs]).resolve()
    else if (_.isFunction(xs)) this.#generator = xs
  }

  write (x) {
    if (this.#nilPushed) throw new Error('Cannot write to stream after nil')
    const isError = !!x.__exstreamError// false// x instanceof Error

    if (this.consumeFn) {
      let nextCalled = false
      this.consumeFn(isError ? x : undefined, isError ? undefined : x, this.#send, () => {
        nextCalled = true
        if (this.paused) this.resume()
      })
      if (!nextCalled) this.pause()
    } else if (this.paused) {
      this.#buffer.push(x)
    } else if (isError) {
      this.#send(x)
    } else {
      this.#send(null, x)
    }

    return !this.paused
  }

  #send = (err, x) => {
    for (let i = 0, len = this.#consumers.length; i < len; i++) {
      this.#consumers[i].write(err || x)
    }

    if (x === _.nil) {
      this.#nilPushed = true
      this.emit('end')
    }
  }

  end = () => {
    if (!this.#nilPushed) this.write(_.nil)
  }

  // eslint-disable-next-line no-use-before-define
  resume = _.debounce(() => {
    if (!this.paused || this.#nilPushed) return
    this.paused = false
    if (this.source) this.source.#checkBackPressure()
    if (this.paused) return
    if (this.#sourceData) {
      do {
        const nextVal = this.#sourceData.next()
        if (!nextVal.done) this.write(nextVal.value)
        else this.end()
      } while (!this.#nilPushed && !this.paused)
    } else if (this.#generator) {
      let nextCalled = false
      this.#generator(this.#send, () => { nextCalled = true; if (this.paused) this.resume() })
      if (!nextCalled) this.pause()
    } else if (this.#buffer.length) {
      let i = 0
      for (const len = this.#buffer.length; i < len; i++) {
        this.write(this.#buffer[i])
        if (this.paused) break
      }
      this.#buffer = this.#buffer.slice(i + 1)
    }
    this.emit('drain')
  })

  pause () {
    if (this.paused) return
    this.paused = true
    if (this.source) this.source.pause()
  }

  #checkBackPressure = () => {
    if (!this.#consumers.length) {
      this.pause()
      return
    }
    for (let i = 0, len = this.#consumers.length; i < len; i++) {
      if (this.#consumers[i].paused) {
        this.pause()
        return
      }
    }

    if (this.paused) this.resume()
  }

  #addConsumer = s => {
    if (this.#consumers.length) {
      throw new Error(
        'This stream has already been transformed or consumed. Please ' +
        'fork() or observe() the stream if you want to perform ' +
        'parallel transformations.'
      )
    }
    s.source = this
    this.#consumers.push(s)
    this.#checkBackPressure()
  }

  _removeConsumer (s) {
    this.#consumers = this.#consumers.filter(c => c !== s)
    if (s.source === this) s.source = null
    this.#checkBackPressure()
  };

  consume (fn) {
    const s = _()
    s.consumeFn = fn
    this.#addConsumer(s)
    return s
  }

  collect () {
    const xs = []
    return this.consume((err, x, push, next) => {
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

  pull (f) {
    const s = this.consume((err, x) => {
      s.source._removeConsumer(s)
      f(err, x)
    })
    s.resume()
  }

  each (f) {
    const s = this.consume((err, x, push, next) => {
      if (err) {
        this.emit('error', err)
      } else if (x === _.nil) {
        push(null, _.nil)
      } else {
        f(x)
        next()
      }
    })
    s.resume()
    return s
  }

  pipe = (dest, options = {}) => {
    const canClose = dest !== process.stdout && dest !== process.stderr && options.end !== false
    const end = canClose ? dest.end : () => {}
    const s = this.consume((err, x, push, next) => {
      if (x === _.nil) {
        end.call(dest)
      } else if (!dest.write(x || err)) {
        dest.once('drain', next)
      } else {
        next()
      }
    })
    dest.emit('pipe', this)
    setImmediate(s.resume)
    return dest
  }

  through = target => {
    if (_.isExstream(target)) {
      this.#addConsumer(target)
      return target
    } else if (_.isReadableStream(target)) {
      this.pipe(target)
      return _(target)
    } else throw Error('You must pass an exstream instance or a node stream')
  }

  then = fn => this.map(x => x.then(fn))

  resolve = (parallelism = 1, preserveOrder = true) => {
    const promises = []
    let ended = false

    return this.consume((err, x, push, next) => {
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
        promises.push(x)
        if (promises.length < parallelism) next()
        x.then(res => {
          const idx = promises.indexOf(x)
          if (preserveOrder) {
            x.result = res
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
      }
    })
  }

  toPromise = () => new Promise((resolve, reject) => this.toArray(resolve))

  map = f => this.consume((err, x, push, next) => {
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

  filter = f => this.consume((err, x, push, next) => {
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

  batch = size => {
    let buffer = []
    return this.consume((err, x, push, next) => {
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

  uniq = fields => {
    const seen = new Set()
    return this.consume((err, x, push, next) => {
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

  uniqBy = cfg => {
    const seen = new Set()
    const isFn = _.isFunction(cfg)
    if (!isFn && !Array.isArray(cfg)) cfg = [cfg]

    const fn = !isFn ? x => cfg.map(f => x[f]).join('_') : cfg

    return this.consume((err, x, push, next) => {
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

  flatten = () => this.consume((err, x, push, next) => {
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

  toArray = f => this.collect().pull((err, x) => {
    if (err) {
      this.emit('error', err)
    } else {
      f(x)
    }
  })

  toNodeStream = options => this.pipe(new Transform({
    transform: function (chunk, enc, cb) {
      this.push(chunk)
      cb()
    },
    ...options
  }))
}

const _ = xs => new Exstream(xs)
_.nil = {}
_.isExstream = x => !!x.__exstream__
_.isDefined = x => x !== null && x !== undefined
_.has = (x, prop) => _.isDefined(x) && Object.hasOwnProperty.call(x, prop)
_.isIterable = x => _.isDefined(x) && typeof x[Symbol.iterator] === 'function'
_.isPromise = x => x instanceof Promise
_.isAsyncIterable = x => _.isDefined(x) && typeof x[Symbol.asyncIterator] === 'function'
_.isFunction = x => typeof x === 'function'
_.isReadableStream = x => x && _.isFunction(x.on) && _.isFunction(x.pipe)
_.extend = (name, fn) => {
  Exstream.prototype[name] = function () {
    return fn(this)
  }
}
_.debounce = fn => {
  let isRunning = false
  return (...args) => {
    if (isRunning) return
    isRunning = true
    fn(...args)
    isRunning = false
  }
}

module.exports = _
