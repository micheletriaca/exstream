require('./platform-runtime.js')
const { BufferOverflowError, Exstream } = require('./exstream')
const methods = require('./methods')
const csv = require('./csv')
const json = require('./json')
const joins = require('./joins')
const events = require('./events.js')
const utils = require('./utils')
const { dataValue } = require('./protocol')
const { errorInfo } = require('./error-info.js')
const { createDeferredSource } = require('./deferred.js')

const operators = Object.assign({}, csv, json, joins, methods)
const _ = (module.exports = Object.assign((xs, options) => new Exstream(xs, options), {
  BufferOverflowError,
  CsvParseError: csv.CsvParseError,
  CsvStringifyError: csv.CsvStringifyError,
  JsonParseError: json.JsonParseError,
  JsonStringifyError: json.JsonStringifyError,
  MapAsyncTimeoutError: methods.MapAsyncTimeoutError,
  data: dataValue,
  defer: createDeferredSource,
  destination: methods.destination,
  errorInfo,
  fromEvent: events.fromEvent,
  nil: utils.nil,
  pipeline: methods.pipeline,
}))

const installMethod = (name, fn, options = null) => {
  Exstream.prototype[name] = fn
  methods.registerPipelineOperator(name, !options || options.pipeline !== false)
}
installMethod('errors', function (fn) {
  return operators.errors(fn, this)
})
installMethod('skipErrors', function (predicate = null) {
  return operators.skipErrors(predicate, this)
})
installMethod('failOnError', function () {
  return operators.failOnError(this)
})
installMethod(
  'routeErrors',
  function () {
    return operators.routeErrors(this)
  },
  { pipeline: false },
)
installMethod('stopOnError', function (fn) {
  return operators.stopOnError(fn, this)
})
installMethod('map', function (fn, options = null) {
  return operators.map(fn, options, this)
})
installMethod('withContext', function (fn = null) {
  return operators.withContext(fn, this)
})
installMethod('extendContext', function (fn) {
  return operators.extendContext(fn, this)
})
installMethod('flatMap', function (fn) {
  return operators.flatMap(fn, this)
})
installMethod('tap', function (fn) {
  return operators.tap(fn, this)
})
installMethod('compact', function () {
  return operators.compact(this)
})
installMethod('find', function (fn) {
  return operators.find(fn, this)
})
installMethod('pluck', function (field, defaultValue) {
  return operators.pluck(field, defaultValue, this)
})
installMethod('pick', function (fields) {
  return operators.pick(fields, this)
})
installMethod('omit', function (fields) {
  return operators.omit(fields, this)
})
installMethod('filter', function (fn) {
  return operators.filter(fn, this)
})
installMethod('reject', function (fn) {
  return operators.reject(fn, this)
})
installMethod('stopWhen', function (fn) {
  return operators.stopWhen(fn, this)
})
installMethod('flatten', function () {
  return operators.flatten(this)
})
installMethod('uniq', function () {
  return operators.uniq(this)
})
installMethod('uniqBy', function (cfg) {
  return operators.uniqBy(cfg, this)
})
installMethod('collect', function () {
  return operators.collect(this)
})
installMethod('batch', function (size) {
  return operators.batch(size, this)
})
installMethod('mapAsync', function (fn, options = null) {
  return operators.mapAsync(fn, options, this)
})
installMethod('csv', function (opts) {
  return operators.csv(opts, this)
})
installMethod('csvStringify', function (opts) {
  return operators.csvStringify(opts, this)
})
installMethod('json', function (opts) {
  return operators.json(opts, this)
})
installMethod('jsonStringify', function (opts) {
  return operators.jsonStringify(opts, this)
})
installMethod('jsonl', function (opts) {
  return operators.jsonl(opts, this)
})
installMethod('jsonlStringify', function (opts) {
  return operators.jsonlStringify(opts, this)
})
installMethod('slice', function (start, end = Infinity) {
  return operators.slice(start, end, this)
})
installMethod('take', function (n) {
  return operators.take(n, this)
})
installMethod('head', function () {
  return operators.head(this)
})
installMethod('last', function () {
  return operators.last(this)
})
installMethod('drop', function (n) {
  return operators.drop(n, this)
})
installMethod('throttle', function (ms) {
  return operators.throttle(ms, this)
})
installMethod('reduce', function (fn, initialValue) {
  return operators.reduce(fn, initialValue, arguments.length >= 2, this)
})
installMethod('groupBy', function (fnOrString) {
  return operators.groupBy(fnOrString, this)
})
installMethod('keyBy', function (fnOrString) {
  return operators.keyBy(fnOrString, this)
})
installMethod('sort', function (compare) {
  return operators.sort(compare, this)
})
installMethod('split', function (encoding = 'utf8') {
  return operators.split(encoding, this)
})
installMethod('encode', function (encoding) {
  return operators.encode(encoding, this)
})
installMethod('decode', function (encoding) {
  return operators.decode(encoding, this)
})
installMethod('splitBy', function (regexp, encoding = 'utf8') {
  return operators.splitBy(regexp, encoding, this)
})
installMethod('makeAsync', function (ms) {
  return operators.makeAsync(ms, this)
})
installMethod('where', function (props) {
  return operators.where(props, this)
})
installMethod('findWhere', function (props) {
  return operators.findWhere(props, this)
})
installMethod('ratelimit', function (num, ms) {
  return operators.ratelimit(num, ms, this)
})
installMethod('sortedGroupBy', function (fnOrString) {
  return operators.sortedGroupBy(fnOrString, this)
})
installMethod(
  'sortedJoin',
  function (right, options) {
    return joins.sortedJoin(this, right, options)
  },
  { pipeline: false },
)