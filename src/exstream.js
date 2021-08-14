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

  #buffer = []
  #sourceData = null
  #generator = null

  consumeFn = null
  #nextCalled = true
  #consumers = []
  _autostart = true

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
    } else if (this.consumeFn) {
      this.#nextCalled = false
      let syncNext = true
      this._currentRec = x
      this.consumeFn(isError ? x : undefined, isError ? undefined : x, this.#send, () => {
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
      this.emit('end')
    }
  }

  start () {
    this._autostart = true
    this.resume()
  }

  end () {
    if (!this.#nilPushed) this.write(_.nil)
  }

  pause () {
    if (this.source) this.source.pause()
    this.paused = true
  }

  resume = () => {
    if (this.#nilPushed || !this._autostart || !this.#nextCalled || !this.paused) return
    this.paused = false

    if (this.#buffer.length) {
      let i = 0
      for (const len = this.#buffer.length; i < len; i++) {
        if (!this.write(this.#buffer[i])) break // write can synchronously pause the stream again in case of back pressure
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
    res.consumeFn = fn
    ;(this.endOfChain || this)._addConsumer(res)
    return res
  }

  _addConsumer = (s, skipCheck = false) => {
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

  _removeConsumer (s) {
    this.#consumers = this.#consumers.filter(c => c !== s)
    if (s.source === this) s.source = null
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
    dest.emit('pipe', this)
    setImmediate(s.resume)
    return dest
  }

  fork () {
    this._autostart = false
    const res = new Exstream()
    this._addConsumer(res, true)
    return res
  }

  through = target => {
    if (_.isExstream(target)) {
      const findParent = x => x.source ? findParent(x.source) : x
      this._addConsumer(findParent(target))
      return target
    } else if (_.isExstreamPipeline(target)) {
      const pipelineInstance = target.generateStream()
      this._addConsumer(pipelineInstance)
      return pipelineInstance
    } else if (_.isReadableStream(target)) {
      this.pipe(target)
      return new Exstream(target)
    } else throw Error('You must pass a non consumed exstream instance, a pipeline or a node stream')
  }

  merge () {
    const merged = new Exstream()
    let toBeEnded = 0
    this.each(subS => {
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

  multi = (numThreads, batchSize, s) => {
    return this.batch(batchSize).map(x => new Exstream(x).through(s))
  }
}

module.exports = Exstream
