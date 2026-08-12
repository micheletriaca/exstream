const { EventEmitter } = require('node:events')

test('the explicit Node package entry preserves EventEmitter compatibility', () => {
  const node = require('exstream.js/node')

  expect(node([1])).toBeInstanceOf(EventEmitter)
})