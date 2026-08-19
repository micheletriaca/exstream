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

const _ = (module.exports = Object.assign(
  (xs, options) => new Exstream(xs, options),
  { BufferOverflowError, data: dataValue, defer: createDeferredSource, errorInfo, nil: utils.nil },
  csv,
  json,
  joins,
  events,
  methods,
))

const installMethod = (name, fn, options = null) => {
  Exstream.prototype[name] = fn
  methods.registerPipelineOperator(name, !options || options.pipeline !== false)
}
installMethod('errors', function (fn) {
  return _.errors(fn, this)
})
installMethod('skipErrors', function (predicate = null) {
  return _.skipErrors(predicate, this)
})
installMethod('failOnError', function () {
  return _.failOnError(this)
})
installMethod(
  'routeErrors',
  function () {
    return _.routeErrors(this)
  },
  { pipeline: false },
)
installMethod('stopOnError', function (fn) {
  return _.stopOnError(fn, this)
})
installMethod('map', function (fn, options = null) {
  return _.map(fn, options, this)
})
installMethod('withContext', function (fn = null) {
  return _.withContext(fn, this)
})
installMethod('extendContext', function (fn) {
  return _.extendContext(fn, this)
})
installMethod('flatMap', function (fn) {
  return _.flatMap(fn, this)
})
installMethod('tap', function (fn) {
  return _.tap(fn, this)
})
installMethod('compact', function () {
  return _.compact(this)
})
installMethod('find', function (fn) {
  return _.find(fn, this)
})
installMethod('pluck', function (field, defaultValue) {
  return _.pluck(field, defaultValue, this)
})
installMethod('pick', function (fields) {
  return _.pick(fields, this)
})
installMethod('omit', function (fields) {
  return _.omit(fields, this)
})
installMethod('filter', function (fn) {
  return _.filter(fn, this)
})
installMethod('reject', function (fn) {
  return _.reject(fn, this)
})
installMethod('asyncFilter', function (fn) {
  return _.asyncFilter(fn, this)
})
installMethod('stopWhen', function (fn) {
  return _.stopWhen(fn, this)
})
installMethod('flatten', function () {
  return _.flatten(this)
})
installMethod('uniq', function () {
  return _.uniq(this)
})
installMethod('uniqBy', function (cfg) {
  return _.uniqBy(cfg, this)
})
installMethod('collect', function () {
  return _.collect(this)
})
installMethod('batch', function (size) {
  return _.batch(size, this)
})
installMethod('mapAsync', function (fn, options = null) {
  return _.mapAsync(fn, options, this)
})
installMethod('csv', function (opts) {
  return _.csv(opts, this)
})
installMethod('csvStringify', function (opts) {
  return _.csvStringify(opts, this)
})
installMethod('json', function (opts) {
  return _.json(opts, this)
})
installMethod('jsonStringify', function (opts) {
  return _.jsonStringify(opts, this)
})
installMethod('jsonl', function (opts) {
  return _.jsonl(opts, this)
})
installMethod('jsonlStringify', function (opts) {
  return _.jsonlStringify(opts, this)
})
installMethod('slice', function (start, end = Infinity) {
  return _.slice(start, end, this)
})
installMethod('take', function (n) {
  return _.take(n, this)
})
installMethod('head', function () {
  return _.head(this)
})
installMethod('last', function () {
  return _.last(this)
})
installMethod('drop', function (n) {
  return _.drop(n, this)
})
installMethod('throttle', function (ms) {
  return _.throttle(ms, this)
})
installMethod('reduce', function (memo, fn) {
  return _.reduce(memo, fn, this)
})
installMethod('groupBy', function (fnOrString) {
  return _.groupBy(fnOrString, this)
})
installMethod('keyBy', function (fnOrString) {
  return _.keyBy(fnOrString, this)
})
installMethod('sort', function () {
  return _.sort(this)
})
installMethod('sortBy', function (fn) {
  return _.sortBy(fn, this)
})
installMethod('split', function (encoding = 'utf8') {
  return _.split(encoding, this)
})
installMethod('encode', function (encoding) {
  return _.encode(encoding, this)
})
installMethod('decode', function (encoding) {
  return _.decode(encoding, this)
})
installMethod('splitBy', function (regexp, encoding = 'utf8') {
  return _.splitBy(regexp, encoding, this)
})
installMethod('reduce1', function (fn) {
  return _.reduce1(fn, this)
})
installMethod('asyncReduce', function (memo, fn) {
  return _.asyncReduce(memo, fn, this)
})
installMethod('makeAsync', function (ms) {
  return _.makeAsync(ms, this)
})
installMethod('where', function (props) {
  return _.where(props, this)
})
installMethod('findWhere', function (props) {
  return _.findWhere(props, this)
})
installMethod('ratelimit', function (num, ms) {
  return _.ratelimit(num, ms, this)
})
installMethod('sortedGroupBy', function (fnOrString) {
  return _.sortedGroupBy(fnOrString, this)
})
installMethod(
  'sortedJoin',
  function (joinKeyOrFnA, joinKeyOrFnB, type = 'inner', sortDirection = 'asc', buffer = 1) {
    return _.sortedJoin(joinKeyOrFnA, joinKeyOrFnB, type, sortDirection, buffer, this)
  },
  { pipeline: false },
)