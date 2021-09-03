// __mocks__/fs.js
'use strict'

const h = require('../test/helpers.js')
const _ = require('../src/index')

const fs = jest.createMockFromModule('fs')

let mockFiles = {}
function __setMockFiles (newMockFiles) {
  mockFiles = newMockFiles
}

function createReadStream (file) {
  return _(mockFiles[file])
    .batch(1000)
    .map(async x => {
      await h.sleep(10)
      return x
    })
    .resolve()
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
