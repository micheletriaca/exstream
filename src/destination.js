const createDestination = (run) => {
  if (typeof run !== 'function') {
    throw Error('error in destination(). run must be a function')
  }

  const destination = { __exstream_destination__: true }
  Object.defineProperty(destination, '_run', { value: run })
  return Object.freeze(destination)
}

module.exports = { createDestination }