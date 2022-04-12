/* eslint-disable max-len */
const { Exstream } = require('./exstream')
const methods = require('./methods')
const csv = require('./csv')
const joins = require('./joins')
const highLevel = require('./high-level')
const utils = require('./utils')

const _ = module.exports = Object.assign(
  xs => new Exstream(xs),
  utils,
  csv,
  joins,
  highLevel,
  methods,
)

/* eslint-disable max-statements-per-line */
_.extend = (name, fn) => { Exstream.prototype[name] = fn }
_.extend('errors', function (fn) { return _.errors(fn, this) })
_.extend('stopOnError', function (fn) { return _.stopOnError(fn, this) })
_.extend('map', function (fn, options = null) { return _.map(fn, options, this) })
_.extend('flatMap', function (fn) { return _.flatMap(fn, this) })
_.extend('tap', function (fn) { return _.tap(fn, this) })
_.extend('compact', function () { return _.compact(this) })
_.extend('find', function (fn) { return _.find(fn, this) })
_.extend('pluck', function (field, defaultValue) { return _.pluck(field, defaultValue, this) })
_.extend('pick', function (fields) { return _.pick(fields, this) })
_.extend('omit', function (fields) { return _.omit(fields, this) })
_.extend('filter', function (fn) { return _.filter(fn, this) })
_.extend('reject', function (fn) { return _.reject(fn, this) })
_.extend('asyncFilter', function (fn) { return _.asyncFilter(fn, this) })
_.extend('stopWhen', function (fn) { return _.stopWhen(fn, this) })
_.extend('flatten', function () { return _.flatten(this) })
_.extend('uniq', function () { return _.uniq(this) })
_.extend('uniqBy', function (cfg) { return _.uniqBy(cfg, this) })
_.extend('collect', function () { return _.collect(this) })
_.extend('batch', function (size) { return _.batch(size, this) })
_.extend('massThen', function (fn) { return _.massThen(fn, this) })
_.extend('massCatch', function (fn) { return _.massCatch(fn, this) })
_.extend('resolve', function (parallelism = 1, preserveOrder = true) {
  return _.resolve(parallelism, preserveOrder, this)
})
_.extend('csv', function (opts) { return _.csv(opts, this) })
_.extend('csvStringify', function (opts) { return _.csvStringify(opts, this) })
_.extend('slice', function (start, end = Infinity) { return _.slice(start, end, this) })
_.extend('take', function (n) { return _.take(n, this) })
_.extend('head', function () { return _.head(this) })
_.extend('last', function () { return _.last(this) })
_.extend('drop', function (n) { return _.drop(n, this) })
_.extend('throttle', function (ms) { return _.throttle(ms, this) })
_.extend('reduce', function (memo, fn) { return _.reduce(memo, fn, this) })
_.extend('groupBy', function (fnOrString) { return _.groupBy(fnOrString, this) })
_.extend('keyBy', function (fnOrString) { return _.keyBy(fnOrString, this) })
_.extend('sort', function () { return _.sort(this) })
_.extend('sortBy', function (fn) { return _.sortBy(fn, this) })
_.extend('split', function (encoding = 'utf8') { return _.split(encoding, this) })
_.extend('encode', function (encoding) { return _.encode(encoding, this) })
_.extend('decode', function (encoding) { return _.decode(encoding, this) })
_.extend('splitBy', function (regexp, encoding = 'utf8') {
  return _.splitBy(regexp, encoding, this)
})
_.extend('reduce1', function (fn) { return _.reduce1(fn, this) })
_.extend('asyncReduce', function (memo, fn) { return _.asyncReduce(memo, fn, this) })
_.extend('makeAsync', function (ms) { return _.makeAsync(ms, this) })
_.extend('toArray', function (fn) { return _.toArray(fn, this) })
_.extend('toPromise', function () { return _.toPromise(this) })
_.extend('toNodeStream', function (options) { return _.toNodeStream(options, this) })
_.extend('toAsyncIterator', function (options) { return _.toNodeStream(options, this) })
_.extend('where', function (props) { return _.where(props, this) })
_.extend('findWhere', function (props) { return _.findWhere(props, this) })
_.extend('ratelimit', function (num, ms) { return _.ratelimit(num, ms, this) })
_.extend('sortedGroupBy', function (fnOrString) { return _.sortedGroupBy(fnOrString, this) })
_.extend('externalSortBy', function (fnOrString, batchSize = 10000) { return _.externalSortBy(fnOrString, batchSize, this) })
_.extend('sortedJoin', function (joinKeyOrFnA, joinKeyOrFnB, type = 'inner', sortDirection = 'asc', buffer = 1) {
  return _.sortedJoin(joinKeyOrFnA, joinKeyOrFnB, type, sortDirection, buffer, this)
})
