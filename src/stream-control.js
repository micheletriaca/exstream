const kAbort = Symbol('exstream.abort')
const kDestroy = Symbol('exstream.destroy')
const kFail = Symbol('exstream.fail')
const kPause = Symbol('exstream.pause')
const kResume = Symbol('exstream.resume')

module.exports = { kAbort, kDestroy, kFail, kPause, kResume }