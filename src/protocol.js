const frameBrand = Symbol('exstream frame')
const dataValueBrand = Symbol('exstream data value')

const DATA = 0
const ERROR = 1
const END = 2

const endFrame = { [frameBrand]: true, type: END }

const dataFrame = (value) => ({ [frameBrand]: true, type: DATA, value })
const errorFrame = (error, input = error && error.exstreamInput, fatal = false) => ({
  [frameBrand]: true,
  type: ERROR,
  error,
  input,
  fatal,
})

const dataValue = (value) => ({ [dataValueBrand]: true, value })
const isDataValue = (value) => value && value[dataValueBrand] === true

module.exports = {
  DATA,
  END,
  ERROR,
  dataFrame,
  dataValue,
  endFrame,
  errorFrame,
  isDataValue,
}