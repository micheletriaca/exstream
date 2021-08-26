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
  ended = false
  #nilPushed = false

  #buffer = []
  #sourceData = null
  #generator = null

  #consumeFn = null
  #consumeSyncFn = null
  #nextCalled = true
  #consumers = []
  #autostart = true
  #synchronous = true
  #onStreamError = e => { this.#write(e); this.end() }

  #destroyers = []

  constructor (xs) {
    super()
    if (!xs) {
      return this
    } else if (_.isExstream(xs)) {
      return xs
    } else if (_.isReadableStream(xs)) {
      xs.once('error', this.#onStreamError).pipe(this)
      this.#destroyers.push(() => xs.off('error', this.#onStreamError))
      this.#synchronous = false
    } else if (_.isIterable(xs)) {
      this.#sourceData = xs[Symbol.iterator]()
    } else if (_.isAsyncIterable(xs)) {
      const r = Readable.from(xs)
      r.once('error', this.#onStreamError).pipe(this)
      this.#destroyers.push(() => r.off('error', this.#onStreamError))
      this.#synchronous = false
    } else if (_.isPromise(xs)) {
      return new Exstream([xs]).resolve()
    } else if (_.isFunction(xs)) {
      this.#generator = xs
      this.#synchronous = false
    }
  }

  write (x) {
    if (this.#nilPushed) throw new Error('Cannot write to stream after nil')
    return this.#write(x)
  }

  #write = (x, skipBackPressure = false) => {
    if (x === _.nil) this.#nilPushed = true
    const isError = x instanceof Error

    if (this.paused && !skipBackPressure) {
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
    } else if (this.#consumeSyncFn) {
      this._currentRec = x
      this.#consumeSyncFn(isError ? x : undefined, isError ? undefined : x, this.#send)
    } else if (isError) {
      this.#send(x)
    } else {
      this.#send(null, x)
    }

    return !this.paused || skipBackPressure
  }

  #send = (err, x) => {
    const wrappedError = _.isDefined(err) ? new ExstreamError(err, this._currentRec) : null
    if (x === _.nil) process.nextTick(() => this.end())
    for (let i = 0, len = this.#consumers.length; i < len; i++) {
      this.#consumers[i].#write(wrappedError || x)
    }
  }

  start () {
    this.#autostart = true
    this.resume()
  }

  end () {
    if (this.ended) return
    if (!this.#nilPushed) this.#write(_.nil)
    this.ended = true
    this.emit('end')
    if (this.paused) this.flushBuffer(true)
    while (this.#consumers.length) this.#removeConsumer(this.#consumers[0])
    const source = this.source
    if (source) {
      source.#removeConsumer(this)
      if (source.#consumers.length === 0) source.destroy()
    }
    this.#generator = null
    this.#sourceData = null
    this.removeAllListeners()
    this.#destroyers.forEach(x => x())
    this.#destroyers = []
  }

  destroy () {
    if (this.paused) this.#buffer = [] // destroy brutally ends the stream discarding pending data
    this.end()
  }

  flushBuffer (force = false) {
    if (this.#buffer.length) {
      let i = 0
      for (const len = this.#buffer.length; i < len; i++) {
        if (!this.#write(this.#buffer[i], force)) break // write can synchronously pause the stream in case of back pressure
      }
      this.#buffer = this.#buffer.slice(i + 1)
    }
  }

  pause () {
    this.paused = true
    if (this.source) this.source.pause()
  }

  resume () {
    if (!this.#autostart || !this.#nextCalled || !this.paused) return
    this.paused = false

    this.flushBuffer() // This can pause the stream again if the consumers are slow

    if (this.paused) return
    if (this.#sourceData) {
      let nextVal
      do {
        try {
          nextVal = this.#sourceData.next()
          if (!nextVal.done) this.#write(nextVal.value)
          else this.end()
        } catch (e) {
          // es6 generator fatal error. Must end the stream
          this.#write(e)
          this.end()
        }
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
    if (!this.#consumers.length) return this.pause()
    for (let i = 0, len = this.#consumers.length; i < len; i++) {
      if (this.#consumers[i].paused) return this.pause()
    }
    this.resume()
  }

  consume (fn) {
    this.#synchronous = false
    const res = new Exstream()
    res.#consumeFn = fn
    ;(this.endOfChain || this).#addConsumer(res)
    return res
  }

  consumeSync (fn) {
    const res = new Exstream()
    res.#consumeSyncFn = fn
    ;(this.endOfChain || this).#addConsumer(res)
    return res
  }

  pull (fn) {
    const s2 = this.consumeSync((err, x) => {
      this.#removeConsumer(s2)
      fn(err, x)
    })
    s2.resume()
  }

  each (fn) {
    const s2 = this.consumeSync((err, x, push) => {
      if (err) {
        ;(this.endOfChain || this).emit('error', err)
      } else if (x === _.nil) {
        push(null, _.nil)
      } else {
        fn(x)
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

  #removeConsumer = s => {
    this.#consumers = this.#consumers.filter(c => c !== s)
    if (s.source === this) s.source = null
    this.#checkBackPressure()
  }

  pipe (dest, options = {}) {
    this.#synchronous = false
    if (_.isExstream(dest) || _.isExstreamPipeline(dest)) return this.through(dest)
    const canClose = dest !== process.stdout && dest !== process.stderr && options.end !== false
    const end = canClose ? dest.end : () => {}
    const s = this.consume((err, x, push, next) => {
      if (x === _.nil) {
        dest.off('drain', next)
        process.nextTick(() => end.call(dest))
      } else if (!dest.write(x || err)) {
        dest.once('drain', next)
      } else {
        next()
      }
    })
    const onEnd = () => s.end()
    dest.once('close', onEnd)
    dest.once('finish', onEnd)
    this.#destroyers.push(() => {
      dest.off('close', onEnd)
      dest.off('finish', onEnd)
    })
    dest.emit('pipe', this)
    setImmediate(() => s.resume())
    return dest
  }

  fork () {
    this.#synchronous = false
    this.#autostart = false
    const res = new Exstream()
    this.#addConsumer(res, true)
    return res
  }

  through (target) {
    if (!target) return this
    else if (_.isExstream(target)) {
      const findParent = x => x.source ? findParent(x.source) : x
      this.#addConsumer(findParent(target))
      return target
    } else if (_.isExstreamPipeline(target)) {
      const pipelineInstance = target.generateStream()
      this.#addConsumer(pipelineInstance)
      return pipelineInstance
    } else if (_.isReadableStream(target)) {
      this.#synchronous = false
      this.pipe(target)
      return new Exstream(target)
    } else if (_.isFunction(target)) {
      return target(this)
    } else throw Error('You must pass a non consumed exstream instance, a pipeline or a node stream')
  }

  merge (parallelism = 1, preserveOrder = true) {
    this.#synchronous = false
    const merged = new Exstream()
    const ss = this.map(subS => {
      if (!_.isExstream(subS)) throw Error('Merge can merge ONLY exstream instances')
      if (!preserveOrder) {
        return new Promise(resolve => {
          const subS2 = subS.consume((err, x, push, next) => {
            if (x === _.nil) {
              merged.off('end', endListener)
              merged.off('drain', next)
              resolve()
            } else if (!merged.#write(err || x)) {
              merged.once('drain', next)
            } else {
              next()
            }
          })
          const endListener = () => subS2.destroy()
          merged.once('end', endListener)
          subS2.resume()
        })
      } else {
        return subS.toPromise()
      }
    }).through(preserveOrder ? null : new Exstream().errors(err => merged.#write(err)))
      .resolve(parallelism, preserveOrder)
      .through(preserveOrder ? new Exstream().flatten() : null)

    if (preserveOrder) return ss
    else {
      ss.once('end', () => merged.end())
        .resume()
      return merged
    }
  }

  multi = (numThreads, batchSize, s) => {
    return this.batch(batchSize).map(x => new Exstream(x).through(s))
  }

  value () {
    const res = this.values()
    if (res.length > 1) throw Error('This stream has emitted more than 1 value. Use .values() instad of .value()')
    return res[0]
  }

  values () {
    let curr = this
    let isSync = this.#synchronous
    while (isSync && curr.source) {
      curr = curr.source
      isSync = isSync && curr.#synchronous
    }
    if (!isSync) throw Error('.value() and .values() methods can be called only if all operations are synchronous')
    let res
    this.toArray(x => (res = x))
    return res
  }
}

module.exports = Exstream
