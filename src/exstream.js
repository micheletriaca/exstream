const EventEmitter = require('events').EventEmitter
const { Readable } = require('stream')
const _ = require('./utils')

class ExstreamError extends Error {
  constructor (e, exstreamInput) {
    super(e.message)
    if (e.exstreamError) {
      return e
    } else if (e instanceof Error) {
      e.exstreamError = true
      e.exstreamInput = exstreamInput
      return e
    } else {
      Object.assign(this, e)
      if (e.stack) this.stack = e.stack
      this.exstreamError = true
      this.exstreamInput = exstreamInput
    }
  }
}

class Exstream extends EventEmitter {
  __exstream__ = true
  writable = true
  readable = true

  #resumedAtLestOnce = false
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
  #observers = []
  #autostart = true
  #synchronous = true

  #destroyers = []

  constructor (xs) {
    super()
    if (!xs) {
      return this
    } else if (_.isExstream(xs)) {
      return xs
    } else if (_.isNodeStream(xs)) {
      this.#pipeReadable(xs)
    } else if (_.isIterable(xs)) {
      this.#sourceData = xs[Symbol.iterator]()
    } else if (_.isAsyncIterable(xs)) {
      this.#pipeReadable(Readable.from(xs))
    } else if (_.isPromise(xs)) {
      return new Exstream([xs]).resolve()
    } else if (_.isFunction(xs)) {
      this.#synchronous = false
      this.#generator = xs
    } else {
      throw Error('error creating exstream: invalid source. source can be one of: iterable, ' +
      'async iterable, exstream function, a promise, a node readable stream')
    }
  }

  #pipeReadable = xs => {
    this.#synchronous = false
    xs.pipe(this)
    this.#addOnceListener('error', xs, e => {
      // sometimes e is not an instance of Error, nobody knows why
      this.write(new ExstreamError(e))
      setImmediate(() => this.end())
    })
    this.once('end', () => xs.destroy())
  }

  #addOnceListener = (event, target, handler) => {
    target.once(event, handler)
    this.#destroyers.push(() => target.off(event, handler))
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
      this.#consumeSyncFn(err, xx, this.#send)
    } else if (this.#consumeFn) {
      this.#nextCalled = false
      let syncNext = true
      this.#consumeFn(err, xx, this.#send, () => {
        this.#nextCalled = true
        if (this.paused && !syncNext) process.nextTick(() => this.resume())
      })
      syncNext = false
      if (!this.#nextCalled) this.pause()
    } else {
      this.#send(err, xx)
    }

    return !this.paused || skipBackPressure
  }

  #send = (err, x) => {
    if (x === _.nil) process.nextTick(() => this.end())
    // i store it locally because this array could be filtered
    // during the loop if one consumer ends (for ex. it can happen withtake or slice)
    const consumers = this.#consumers
    if (err && !this.#consumers.length) this.emit('error', err)
    for (let i = 0, len = consumers.length; i < len; i++) {
      consumers[i].write(err || x)
    }
    for (let i = 0, len = this.#observers.length; i < len; i++) {
      this.#observers[i]._write(err || x, true)
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
    if (this.readable) this.emit('end')
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
    this.#observers = []
  }

  destroy () {
    if (this.paused) this.#buffer = [] // destroy brutally ends the stream discarding pending data
    this.end()
  }

  #flushBuffer = (force = false) => {
    if (!this.#buffer.length) return
    let i = 0
    for (const len = this.#buffer.length; i < len; i++) {
      // write can synchronously pause the stream in case of back pressure
      if (!this._write(this.#buffer[i], force)) break
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
    let syncNext = true
    const w = x => this.write(x)
    const next = otherStream => {
      this.#nextCalled = true
      if (otherStream && !_.isExstream(otherStream)) {
        throw Error(
          'error in generator calling next(otherStream). ' +
          'otherStream must be an exstream instance, got ' + (typeof otherStream),
        )
      }

      if (otherStream) {
        otherStream.#consumers = this.#consumers
        otherStream.#consumers.forEach(x => (x.source = otherStream))
        this.#consumers = []
        this.destroy()
        otherStream.resume()
      } else if (this.paused && !syncNext) process.nextTick(() => this.resume())
    }

    do {
      this.#nextCalled = false
      syncNext = true
      this.#generator(w, next)
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

    this.#resumedAtLestOnce = true
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
    this.#addOnceListener('close', dest, onEnd)
    this.#addOnceListener('finish', dest, onEnd)
    dest.emit('pipe', this)
    setImmediate(() => s.resume())
    return dest
  }

  fork (disableAutostart = false) {
    if (this.#resumedAtLestOnce) throw Error('this stream is already started. you can\'t fork it anymore')
    this.#synchronous = false
    this.#autostart = false
    if (!disableAutostart) process.nextTick(() => this.start())
    const res = new Exstream()
    this.#addConsumer(res, true)
    return res
  }

  observe () {
    const res = new Exstream()
    this.#observers.push(res)
    return res
  }

  through (target, { writable = false } = {}) {
    if (!target) return this
    else if (_.isExstream(target)) {
      const findParent = x => x.source ? findParent(x.source) : x
      this.#addConsumer(findParent(target))
      return target
    } else if (_.isExstreamPipeline(target)) {
      const pipelineInstance = target.generateStream()
      this.#addConsumer(pipelineInstance)
      return pipelineInstance
    } else if (_.isNodeStream(target) && !writable) {
      this.#synchronous = false
      this.pipe(target)
      return new Exstream(target)
    } else if (_.isNodeStream(target) && writable) {
      this.#synchronous = false
      this.pipe(target)
      const s = new Exstream()
      s.readable = false
      s.source = this
      s.resume()
      s.#addOnceListener('error', target, e => { s.write(e); setImmediate(() => s.end()) })
      s.#addOnceListener('finish', target, () => { s.emit('finish'); setImmediate(() => s.destroy()) })
      s.#addOnceListener('close', target, () => { s.emit('close'); setImmediate(() => s.destroy()) })
      return s
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
    if (_.isPromise(res)) {
      return res.then(result => {
        if (result.length > 1) throw Error('this stream has emitted more than 1 value. use .values() instad of .value()')
        return result[0]
      })
    } else if (res.length > 1) {
      throw Error('this stream has emitted more than 1 value. use .values() instad of .value()')
    } else {
      return res[0]
    }
  }

  values () {
    let curr = this
    let isSync = this.#synchronous
    while (isSync && curr.source) {
      curr = curr.source
      isSync = isSync && curr.#synchronous
    }
    if (!isSync) {
      return this.toPromise()
    } else {
      const res = []
      this.consumeSync((err, x, push) => {
        if (err) throw err
        else if (x === _.nil) push(null, _.nil)
        else res.push(x)
      }).resume()
      return res
    }
  }
}

module.exports = {
  Exstream,
  ExstreamError,
}
