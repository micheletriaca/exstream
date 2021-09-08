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
  #currentRec = null
  #nextCalled = true
  #consumers = []
  #autostart = true
  #synchronous = true
  #onStreamError = e => { this.write(e); this.end() }

  #destroyers = []

  constructor (xs) {
    super()
    if (!xs) {
      return this
    } else if (_.isExstream(xs)) {
      return xs
    } else if (_.isReadableStream(xs)) {
      xs.once('error', this.#onStreamError).pipe(this)
      this.once('end', () => xs.destroy())
      this.#destroyers.push(() => xs.off('error', this.#onStreamError))
      this.#synchronous = false
    } else if (_.isIterable(xs)) {
      this.#sourceData = xs[Symbol.iterator]()
    } else if (_.isAsyncIterable(xs)) {
      const r = Readable.from(xs)
      r.once('error', this.#onStreamError).pipe(this)
      this.#destroyers.push(() => r.off('error', this.#onStreamError))
      this.once('end', () => r.destroy())
      this.#synchronous = false
    } else if (_.isPromise(xs)) {
      return new Exstream([xs]).resolve()
    } else if (_.isFunction(xs)) {
      this.#generator = xs
      this.#synchronous = false
    }
  }

  write (x) {
    if (this.#nilPushed) throw Error('Cannot write to stream after nil')
    return this._write(x)
  }

  _write (x, skipBackPressure = false) {
    if (x === _.nil) this.#nilPushed = true
    const isError = _.isError(x)
    const xx = isError ? null : x
    const err = isError ? x : undefined

    if (this.paused && !skipBackPressure) {
      this.#buffer.push(x)
    } else if (this.#consumeSyncFn) {
      this.#currentRec = x
      this.#consumeSyncFn(err, xx, this.#send)
    } else if (this.#consumeFn) {
      this.#nextCalled = false
      let syncNext = true
      this.#currentRec = x
      this.#consumeFn(err, xx, this.#send, () => {
        this.#nextCalled = true
        this.#currentRec = null
        if (this.paused && !syncNext) this.resume()
      })
      syncNext = false
      if (!this.#nextCalled) this.pause()
    } else {
      this.#send(err, xx)
    }

    return !this.paused || skipBackPressure
  }

  #send = (err, x) => {
    const wrappedError = _.isDefined(err) ? new ExstreamError(err, this.#currentRec) : null
    if (x === _.nil) process.nextTick(() => this.end())
    for (let i = 0, len = this.#consumers.length; i < len; i++) {
      this.#consumers[i].write(wrappedError || x)
    }
  }

  start () {
    this.#autostart = true
    // setImmediate is needed to guarantee that .pipe() has resumed the source stream
    return new Promise(resolve => setImmediate(() => { this.resume(); resolve() }))
  }

  end () {
    if (this.ended) return
    if (!this.#nilPushed) this._write(_.nil)
    if (this.paused) this.#flushBuffer(true)
    this.ended = true
    this.emit('end')
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

  #flushBuffer = (force = false) => {
    if (!this.#buffer.length) return
    let i = 0
    for (const len = this.#buffer.length; i < len; i++) {
      if (!this._write(this.#buffer[i], force)) break // write can synchronously pause the stream in case of back pressure
    }
    this.#buffer = this.#buffer.slice(i + 1)
  }

  #consumeSourceData = () => {
    let nextVal
    do {
      try {
        nextVal = this.#sourceData.next()
      } catch (e) {
        // es6 generator fatal error. Must end the stream
        this.write(e)
        this.end()
        return
      }
      if (!nextVal.done) this.write(nextVal.value)
      else this.end()
    } while (!this.#nilPushed && !this.paused)
  }

  #consumeGenerator = () => {
    const w = x => this.write(x)
    do {
      let syncNext = true
      this.#nextCalled = false
      this.#generator(w, () => {
        this.#nextCalled = true
        if (this.paused && !syncNext) this.resume()
      })
      syncNext = false
      if (!this.#nextCalled) this.pause()
    } while (!this.paused && !this.#nilPushed)
  }

  pause () {
    this.paused = true
    if (this.source) this.source.pause()
  }

  resume () {
    if (!this.#autostart || !this.#nextCalled || !this.paused) return

    this.paused = false
    this.#flushBuffer() // This can pause the stream again if the consumers are slow
    if (this.paused) return

    if (this.#sourceData) {
      this.#consumeSourceData() // This can pause the stream again if the consumers are slow
    } else if (this.#generator) {
      this.#consumeGenerator() // This can pause the stream again if the consumers are slow
    }

    if (this.paused) return
    if (!this.source) this.emit('drain')
    else this.source.#checkBackPressure()
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
    this.#addConsumer(res)
    return res
  }

  consumeSync (fn) {
    const res = new Exstream()
    res.#consumeSyncFn = fn
    this.#addConsumer(res)
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
  }

  #addConsumer = (s, skipCheck = false) => {
    const realSource = this.endOfChain || this
    if (!skipCheck && realSource.#consumers.length) {
      throw Error(
        'This stream has already been transformed or consumed. Please ' +
        'fork() or observe() the stream if you want to perform ' +
        'parallel transformations.',
      )
    }
    s.source = realSource
    realSource.#consumers.push(s)
    realSource.#checkBackPressure()
  }

  #removeConsumer = s => {
    this.#consumers = this.#consumers.filter(c => c !== s)
    s.source = null
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
      } else if (err) {
        this.emit('error', err)
        next()
      } else if (!dest.write(x)) {
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
    } else {
      throw Error(
        'error in .through(). you must pass a non consumed' +
        'exstream instance, a pipeline or a node stream',
      )
    }
  }

  merge (parallelism = Infinity, preserveOrder = false) {
    this.#synchronous = false

    const pipeline = preserveOrder
      ? new Exstream().resolve(parallelism, preserveOrder).flatten()
      : new Exstream().errors(err => merged.write(err)).resolve(parallelism, preserveOrder)

    const merged = new Exstream()
    const ss = this.map(subS => {
      if (!_.isExstream(subS)) throw Error('.merge() can merge ONLY exstream instances')
      if (preserveOrder) return subS.toPromise()
      return new Promise(resolve => {
        const subS2 = subS.consume((err, x, push, next) => {
          if (x === _.nil) {
            merged.off('end', endListener)
            merged.off('drain', next)
            resolve()
          } else if (!merged.write(err || x)) {
            merged.once('drain', next)
          } else {
            next()
          }
        })
        const endListener = () => subS2.destroy()
        merged.once('end', endListener)
        subS2.resume()
      })
    }).through(pipeline)

    if (preserveOrder) return ss
    ss.once('end', () => merged.end()).resume()
    return merged
  }

  value () {
    const res = this.values()
    if (res.length > 1) throw Error('this stream has emitted more than 1 value. use .values() instad of .value()')
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
    const res = []
    this.consumeSync((err, x, push) => {
      if (err) throw err
      else if (x === _.nil) push(null, _.nil)
      else res.push(x)
    }).resume()
    return res
  }
}

module.exports = Exstream
