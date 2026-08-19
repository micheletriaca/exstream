const { Exstream, ExstreamError } = require('./exstream.js')
const { runtime } = require('./runtime.js')
const _ = require('./utils.js')

const isSource = (source) =>
  _.isExstream(source) ||
  _.isNodeStream(source) ||
  runtime.isWebReadableStream(source) ||
  _.isIterable(source) ||
  _.isAsyncIterable(source) ||
  _.isPromise(source) ||
  _.isFunction(source)

const createDeferredSource = (factory, options = null) => {
  if (typeof factory !== 'function') throw Error('defer() requires a source factory')

  let invoked = false
  return new Exstream((write, next) => {
    if (invoked) return
    invoked = true

    const fail = (reason) => {
      write(new ExstreamError(reason, void 0, { origin: 'source', stage: 'defer' }))
      write(_.nil)
    }
    const activate = (source) => {
      if (!isSource(source)) {
        fail(Error('defer() factory must return a valid stream source'))
        return
      }
      try {
        next(source)
      } catch (error) {
        fail(error)
      }
    }

    let source
    try {
      source = factory()
    } catch (error) {
      fail(error)
      return
    }

    if (_.isPromise(source)) Promise.resolve(source).then(activate, fail)
    else activate(source)
  }, options)
}

module.exports = { createDeferredSource }