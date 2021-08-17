const _ = module.exports = {}
_.nil = Symbol('exstream nil')
_.isExstream = x => !!x.__exstream__
_.isExstreamPipeline = x => !!x.__exstream_pipeline__
_.isDefined = x => x !== null && x !== undefined
_.has = (x, prop) => _.isDefined(x) && Object.hasOwnProperty.call(x, prop)
_.isIterable = x => _.isDefined(x) && typeof x[Symbol.iterator] === 'function'
_.isPromise = x => x instanceof Promise
_.isAsyncIterable = x => _.isDefined(x) && typeof x[Symbol.asyncIterator] === 'function'
_.isFunction = x => typeof x === 'function'
_.isString = x => typeof x === 'string'
_.isReadableStream = x => x && _.isFunction(x.on) && _.isFunction(x.pipe)
_.escapeRegExp = text => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
