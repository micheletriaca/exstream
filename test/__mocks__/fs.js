// __mocks__/fs.js
'use strict'

const h = require('../helpers.js')
const { Readable } = require('stream')
const fs = jest.createMockFromModule('fs')

let mockFiles = {}
function __setMockFiles (newMockFiles) {
  mockFiles = newMockFiles
}

async function * read (file) {
  for (let i = 0; i < mockFiles[file].length; i++) {
    if (i % 10000 === 0) await h.sleep(10)
    yield mockFiles[file][i]
  }
}

function createReadStream (file) {
  return Readable.from(read(file))
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
