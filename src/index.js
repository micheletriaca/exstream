const Exstream = require('./exstream.js')
const methods = require('./methods')
const utils = require('./utils')

const _ = Object.assign(
  xs => new Exstream(xs),
  utils,
  methods
)

_.extend = (name, fn) => { Exstream.prototype[name] = fn }
_.extend('map', function (fn) { return _.map(fn, this) })
_.extend('collect', function () { return _.collect(this) })
_.extend('pull', function (fn) { return _.pull(fn, this) })
_.extend('each', function (fn) { return _.each(fn, this) })
_.extend('flatten', function () { return _.flatten(this) })
_.extend('toArray', function (fn) { return _.toArray(fn, this) })
_.extend('fork', function () { return _.fork(this) })
_.extend('filter', function (fn) { return _.filter(fn, this) })
_.extend('batch', function (size) { return _.batch(size, this) })
_.extend('uniq', function () { return _.uniq(this) })
_.extend('uniqBy', function (cfg) { return _.uniqBy(cfg, this) })
_.extend('errors', function (fn) { return _.errors(fn, this) })
_.extend('merge', function () { return _.merge(this) })
_.extend('then', function (fn) { return _.then(fn, this) })
_.extend('catch', function (fn) { return _.catch(fn, this) })
_.extend('resolve', function (parallelism, preserveOrder) { return _.resolve(parallelism, preserveOrder, this) })
_.extend('through', function (stream) { return _.through(stream, this) })
_.extend('toPromise', function () { return _.toPromise(this) })
_.extend('csv', function (opts) { return _.csv(opts, this) })
_.extend('toNodeStream', function (options) { return _.toNodeStream(options, this) })
module.exports = _
