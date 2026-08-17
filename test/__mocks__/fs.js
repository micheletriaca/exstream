// __mocks__/fs.js
'use strict'

const h = require('../helpers.js')
const _ = require('../../src/index')

const fs = { readFileSync: vi.fn() }

let mockFiles = {}
function __setMockFiles(newMockFiles) {
  mockFiles = newMockFiles
}

function createReadStream(file) {
  return _(mockFiles[file])
    .batch(1000)
    .map(async (x) => {
      await h.sleep(10)
      return x
    })
    .mapAsync((value) => value)
    .flatten()
    .toNodeReadable()
}

function createWriteStream(file) {
  mockFiles[file] = []
  return h.getSlowWritable(mockFiles[file], 0, 10)
}

fs.__getMockFiles = () => ({ ...mockFiles })
fs.__setMockFiles = __setMockFiles
fs.createReadStream = createReadStream
fs.createWriteStream = createWriteStream

module.exports = fs