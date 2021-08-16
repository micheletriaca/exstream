const EventEmitter = require('events').EventEmitter
const { Readable } = require('stream')
const _ = require('./utils')

class ExstreamError extends Error {
  __exstreamError__ = true
  constructor (originalError, originalData) {
    super(originalError.message)
    if (originalError.__exstreamError__) return originalError
    this.originalError = originalError
    this.originalData = originalData
  }
}

class Exstream extends EventEmitter {
  __exstream__ = true
  writable = true

  paused = true
  #nilPushed = false
  ended = false

  #buffer = []
  #sourceData = null
  #generator = null

  #consumeFn = null
  #nextCalled = true
  #consumers = []
  #autostart = true

  constructor (xs) {
    super()
    if (!xs) return this
    else if (_.isExstream(xs)) return xs
    else if (_.isIterable(xs)) this.#sourceData = xs[Symbol.iterator]()
    else if (_.isReadableStream(xs)) xs.pipe(this)
    else if (_.isAsyncIterable(xs)) Readable.from(xs).pipe(this)
    else if (_.isPromise(xs)) return new Exstream([xs]).resolve()
    else if (_.isFunction(xs)) this.#generator = xs
  }

  write (x) {
    if (this.#nilPushed) throw new Error('Cannot write to stream after nil')
    const isError = x instanceof Error

    if (this.paused) {
      this.#buffer.push(x)
    } else if (this.#consumeFn) {
      this.#nextCalled = false
      let syncNext = true
      this._currentRec = x
      this.#consumeFn(isError ? x : undefined, isError ? undefined : x, this.#send, () => {
        this.#nextCalled = true
        this._currentRec = null
        if (this.paused && !syncNext) this.resume()
      })
      syncNext = false
      if (!this.#nextCalled) this.pause()
    } else if (isError) {
      this.#send(x)
    } else {
      this.#send(null, x)
    }

    return !this.paused
  }

  #send = (err, x) => {
    const wrappedError = _.isDefined(err) ? new ExstreamError(err, this._currentRec) : null
    for (let i = 0, len = this.#consumers.length; i < len; i++) {
      this.#consumers[i].write(wrappedError || x)
    }

    if (x === _.nil) {
      this.#nilPushed = true
      setImmediate(() => this.destroy())
    }
  }

  start () {
    this.#autostart = true
    this.resume()
  }

  end () {
    if (!this.ended) {
      this.ended = true
      this.emit('end')
    }
    if (!this.#nilPushed) this.write(_.nil)
  }

  destroy () {
    this.end()
    while (this.#consumers.length) this.#removeConsumer(this.#consumers[0])
    if (this.source) {
      if (this.source.#consumers.length === 1) this.source.destroy()
      else this.source.#removeConsumer(this)
    } else {
      this.#generator = null
      this.#sourceData = null
    }
  }

  pause () {
    if (this.source) this.source.pause()
    this.paused = true
  }

  resume () {
    if (this.#nilPushed || !this.#autostart || !this.#nextCalled || !this.paused) return
    this.paused = false

    if (this.#buffer.length) {
      let i = 0
      for (const len = this.#buffer.length; i < len; i++) {
        if (!this.write(this.#buffer[i])) break // write can synchronously pause the stream in case of back pressure
      }
      this.#buffer = this.#buffer.slice(i + 1)
    }

    if (this.paused) return
    if (this.#sourceData) {
      do {
        const nextVal = this.#sourceData.next()
        if (!nextVal.done) this.write(nextVal.value)
        else this.end()
      } while (!this.#nilPushed && !this.paused)
    } else if (this.#generator) {
      do {
        let syncNext = true
        this._nextCalled = false
        this.#generator(this.#send, () => {
          this._nextCalled = true
          if (this.paused && !syncNext) this.resume()
        })
        syncNext = false
        if (!this._nextCalled) this.pause()
      } while (!this.paused && !this.#nilPushed)
    }

    if (!this.paused && !this.source) this.emit('drain')
    else if (this.source) this.source.#checkBackPressure()
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

    this.resume()
  }

  consume (fn) {
    const res = new Exstream()
    res.#consumeFn = fn
    ;(this.endOfChain || this).#addConsumer(res)
    return res
  }

  pull (f) {
    const s2 = this.consume((err, x) => {
      s2.source.#removeConsumer(s2)
      f(err, x)
    })
    s2.resume()
  }

  each (f) {
    const s2 = this.consume((err, x, push, next) => {
      if (err) {
        ;(this.endOfChain || this).emit('error', err)
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

  #addConsumer = (s, skipCheck = false) => {
    if (!skipCheck && this.#consumers.length) {
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

  #removeConsumer = (s, propagate = false) => {
    this.#consumers = this.#consumers.filter(c => c !== s)
    if (s.source === this) s.source = null
    // if (this.#consumers.length === 0 && propagate && this.source) this.source.#removeConsumer(this, true)
    this.#checkBackPressure()
  }

  pipe (dest, options = {}) {
    if (_.isExstream(dest) || _.isExstreamPipeline(dest)) return this.through(dest)
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
    dest.once('close', () => s.destroy())
    dest.emit('pipe', this)
    setImmediate(() => s.resume())
    return dest
  }

  fork () {
    this.#autostart = false
    const res = new Exstream()
    this.#addConsumer(res, true)
    return res
  }

  through (target) {
    if (_.isExstream(target)) {
      const findParent = x => x.source ? findParent(x.source) : x
      this.#addConsumer(findParent(target))
      return target
    } else if (_.isExstreamPipeline(target)) {
      const pipelineInstance = target.generateStream()
      this.#addConsumer(pipelineInstance)
      return pipelineInstance
    } else if (_.isReadableStream(target)) {
      this.pipe(target)
      return new Exstream(target)
    } else throw Error('You must pass a non consumed exstream instance, a pipeline or a node stream')
  }

  merge (parallelism = 1) {
    const merged = new Exstream()
    this.map(subS => {
      if (!_.isExstream(subS)) throw Error('Merge can merge ONLY exstream instances')
      return new Promise(resolve => {
        const subS2 = subS.consume((err, x, push, next) => {
          if (x === _.nil) {
            resolve()
          } else if (!merged.write(err || x)) {
            merged.once('drain', next)
          } else {
            next()
          }
        })
        merged.once('end', () => subS2.destroy())
        subS2.resume()
      })
    }).errors(err => merged.write(err))
      .resolve(parallelism, false)
      .on('end', () => merged.end())
      .resume()
    return merged
  }

  multi = (numThreads, batchSize, s) => {
    return this.batch(batchSize).map(x => new Exstream(x).through(s))
  }
}

module.exports = Exstream
