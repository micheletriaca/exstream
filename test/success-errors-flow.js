const _ = require('../src/index.js')
const { pipeline, curry } = _
const errorToJson = require('./error-to-json')

// eslint-disable-next-line no-console
const pattern = (
  {
    logger = console,
    eachError = error => logger.warn(error),
    stopOnError = false,
    errorsPipeline = pipeline(),
  },
  sourceFlow) => {
  const isWrappable = Array.isArray(sourceFlow) || sourceFlow.__exstream__ === true
  const success = isWrappable
    ? _(sourceFlow)
    : sourceFlow()
  const errors = _()
  errors
    .through(errorsPipeline)
    .stopOnError(error => logger.error(error))
    .each(eachError)
  success.on('end', () => errors.end())

  return stopOnError === true
    ? success
      .stopOnError(error => errors.write(errorToJson(error)))
    : success
      .errors(error => errors.write(errorToJson(error)))
}

module.exports = curry(pattern)
