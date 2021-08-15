const Exstream = require('./exstream.js')
const methods = require('./methods')
const utils = require('./utils')

const _ = Object.assign(
  xs => new Exstream(xs),
  utils,
  methods
)

_.extend = (name, fn) => { Exstream.prototype[name] = fn }
_.extend('errors', function (fn) { return _.errors(fn, this) })
_.extend('map', function (fn) { return _.map(fn, this) })
_.extend('filter', function (fn) { return _.filter(fn, this) })
_.extend('flatten', function () { return _.flatten(this) })
_.extend('uniq', function () { return _.uniq(this) })
_.extend('uniqBy', function (cfg) { return _.uniqBy(cfg, this) })
_.extend('collect', function () { return _.collect(this) })
_.extend('batch', function (size) { return _.batch(size, this) })
_.extend('then', function (fn) { return _.then(fn, this) })
_.extend('catch', function (fn) { return _.catch(fn, this) })
_.extend('resolve', function (parallelism, preserveOrder) { return _.resolve(parallelism, preserveOrder, this) })
_.extend('csv', function (opts) { return _.csv(opts, this) })
_.extend('slice', function (start, end) { return _.slice(start, end, this) })
_.extend('take', function (n, opts) { return _.take(n, this) })
_.extend('toArray', function (fn) { return _.toArray(fn, this) })
_.extend('toPromise', function () { return _.toPromise(this) })
_.extend('toNodeStream', function (options) { return _.toNodeStream(options, this) })
module.exports = _
