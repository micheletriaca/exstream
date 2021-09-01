// __mocks__/fs.js
'use strict'

const h = require('../test/helpers.js')
const __ = require('highland')

const fs = jest.createMockFromModule('fs')

let mockFiles = {}
function __setMockFiles (newMockFiles) {
  mockFiles = newMockFiles
}

function createReadStream (file) {
  return __(mockFiles[file])
    .batch(1000)
    .map(x => __(new Promise(resolve => {
      h.sleep(10).then(() => resolve(x))
    })))
    .sequence()
    .flatten()
    .toNodeStream()
}

function createWriteStream (file) {
  mockFiles[file] = []
  return h.getSlowWritable(mockFiles[file], 0, 10)
}

fs.__getMockFiles = () => ({ ...mockFiles })
fs.__setMockFiles = __setMockFiles
fs.createReadStream = createReadStream
fs.createWriteStream = createWriteStream

module.exports = fs
