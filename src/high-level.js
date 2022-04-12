const { Exstream, ExstreamError } = require('./exstream')
const fs = require('fs')
const os = require('os')
const path = require('path')

const _ = require('./utils.js')
const _m = module.exports = {}

function insertSorted (arr, item, comparator) {
/*  if (comparator == null) {
    comparator = (a, b) => {
      if (typeof a !== 'string') a = String(a)
      if (typeof b !== 'string') b = String(b)
      return a > b ? 1 : a < b ? -1 : 0
    }
  }
*/
  let min = 0
  let max = arr.length
  let index = Math.floor((min + max) / 2)
  while (max > min) {
    if (comparator(item, arr[index]) < 0) max = index
    else min = index + 1
    index = Math.floor((min + max) / 2)
  }

  arr.splice(index, 0, item)
  return index
}

const puller = (s, bSize) => {
  const s2 = s.batch(bSize)
  let buffer = []
  const _pull = () => {
    if (buffer === _.nil || !buffer.length) return _.nil
    return buffer.shift()
  }
  return {
    pull: () => {
      if (!buffer.length && !s.nilPushed) {
        return s2.pull().then(res => { buffer = res; return _pull() })
      } else return _pull()
    },
  }
}

_m.externalSortBy = _.curry((fnOrString, batchSize, s) => {
  const fileGenerator = (count = 0, fileKey = _.uuidv4()) => () => path.resolve(os.tmpdir(), fileKey + count++)
  const getFileName = fileGenerator()
  const realFn = (a, b) => fnOrString(a.d, b.d)
  const buffer = []
  let streams
  let initialized = false

  const collect = (write, next) => {
    s.batch(batchSize)
      .map(async x => {
        const fileName = getFileName()
        await new Exstream(x)
          .sortBy(fnOrString)
          .map(x => JSON.stringify(x) + '|||\n')
          .through(fs.createWriteStream(fileName), { writable: true })
          .toPromise()
        return fileName
      })
      .resolve()
      .toPromise()
      .then(files => {
        streams = files.map(f => puller(
          new Exstream(fs.createReadStream(f))
            .on('end', () => fs.unlinkSync(f))
            .splitBy('|||\n')
            .filter(x => x)
            .map(JSON.parse),
          Math.ceil(batchSize / files.length),
        ))
        next()
      })
      .catch(e => {
        write(new ExstreamError(e))
        write(_.nil)
      })
  }

  return new Exstream(async (write, next) => {
    if (!streams) {
      collect(write, next)
    } else if (!initialized) {
      for (let i = 0; i < streams.length; i++) {
        const item = await streams[i].pull()
        insertSorted(buffer, { s: streams[i], d: item }, realFn)
      }
      initialized = true
      next()
    } else if (buffer.length || streams.length) {
      const res = []
      for (let kk = 0; kk < Math.ceil(batchSize / streams.length); kk++) {
        const item = buffer.shift()
        res.push(item.d)
        let newItem = item.s.pull()
        if (newItem.then) newItem = await newItem
        if (newItem !== _.nil) {
          insertSorted(buffer, { s: item.s, d: newItem }, realFn)
        } else {
          streams = streams.filter(x => x !== item.s)
        }
        if (!streams.length || !buffer.length) break
      }
      write(res)
      next()
    } else {
      write(_.nil)
    }
  }).flatten()
})
