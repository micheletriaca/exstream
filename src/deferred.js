const { Exstream } = require('./exstream.js')

const createDeferredSource = (factory, options = null) => {
  if (typeof factory !== 'function') throw Error('defer() requires a source factory')
  return Exstream.fromDeferred(factory, options)
}

module.exports = { createDeferredSource }