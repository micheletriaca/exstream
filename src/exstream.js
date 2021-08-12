const EventEmitter = require('events').EventEmitter
const { Readable } = require('stream')
const _ = require('./utils')

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
    const isError = !!x.__exstreamError// false// x instanceof Error

    if (this.paused) {
      this.#buffer.push(x)
    } else if (this.consumeFn) {
      this.#nextCalled = false
      let syncNext = true
      this.consumeFn(isError ? x : undefined, isError ? undefined : x, this.#send, () => {
        this.#nextCalled = true
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
    for (let i = 0, len = this.#consumers.length; i < len; i++) {
      this.#consumers[i].write(err || x)
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

  resume = _.debounce(() => {
    if (this.#nilPushed || !this._autostart || !this.#nextCalled) return
    this.paused = false
    let canDrain = true
    if (this.paused) return

    if (this.#buffer.length) {
      let i = 0
      for (const len = this.#buffer.length; i < len; i++) {
        this.write(this.#buffer[i])
        // write can synchronously pause the stream again in case of back pressure
        if (this.paused) {
          canDrain = false
          break
        }
      }
      this.#buffer = this.#buffer.slice(i + 1)
      if (!canDrain) return
    }

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
    }

    if (canDrain) this.emit('drain')
    if (this.source) this.source.#checkBackPressure()
  })

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
    const canClose = dest !== process.stdout && dest !== process.stderr && options.end !== false
    const end = canClose ? dest.end : () => {}
    let onNextDrain = null
    const handleDrain = () => onNextDrain && onNextDrain()
    const s = this.consume((err, x, push, next) => {
      if (x === _.nil) {
        end.call(dest)
        dest.off('drain', handleDrain)
      } else if (!dest.write(x || err)) {
        onNextDrain = next
      } else {
        next()
      }
    })
    dest.on('drain', handleDrain)
    dest.emit('pipe', this)
    setImmediate(s.resume)
    return dest
  }

  multi = (numThreads, batchSize, s) => {
    return this.batch(batchSize).map(x => new Exstream(x).through(s))
  }
}

module.exports = Exstream
