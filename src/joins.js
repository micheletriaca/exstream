const { Exstream, ExstreamError } = require('./exstream')

const _ = require('./utils.js')
const _m = module.exports = {}

_m.sortedGroupBy = _.curry((fnOrString, s) => {
  const getter = _.isString(fnOrString) ? _.makeGetter(fnOrString) : fnOrString
  let currentBatch = []
  let currentKey = _.nil

  return s.consumeSync((err, x, push) => {
    if (err) push(err)
    else if (x === _.nil) {
      if (currentBatch.length) push(null, { key: currentKey, values: currentBatch })
      currentBatch = null
      push(null, _.nil)
    } else {
      try {
        const k = getter(x)
        if (currentKey !== k) {
          if (currentKey !== _.nil) push(null, { key: currentKey, values: currentBatch })
          currentBatch = [x]
          currentKey = k
        } else {
          currentBatch.push(x)
        }
      } catch (e) {
        push(new ExstreamError(e, x))
      }
    }
  })
})

const puller = (s, bSize) => {
  const s2 = s.batch(bSize)
  let buffer = []
  const _pull = (shift) => {
    if (buffer === _.nil || !buffer.length) return _.nil
    return shift ? buffer.shift() : buffer[0]
  }
  return {
    pull: (shift = true) => {
      if (!buffer.length && !s.nilPushed) {
        return s2.pull().then(res => { buffer = res; return _pull(shift) })
      } else return _pull(shift)
    },
    shift: () => {
      return buffer.shift()
    },
    destroy: () => {
      s2.destroy()
    },
  }
}

_m.sortedJoin = _.curry((joinKeyOrFnA, joinKeyOrFnB, type, sortDirection, buffer, s) => {
  const getterStream0 = _.isString(joinKeyOrFnA) ? _.makeGetter(joinKeyOrFnA) : joinKeyOrFnA
  const getterStream1 = _.isString(joinKeyOrFnB) ? _.makeGetter(joinKeyOrFnB) : joinKeyOrFnB

  let streams = []
  let block0
  let block1
  let goOnReadingFrom
  let initialized = false
  let stream0Ended = false
  let stream1Ended = false

  const check = (write) => {
    if (!stream0Ended && block0.data === _.nil) {
      stream0Ended = true
      if (type === 'right') write({ b2: block1.data, key: block1.key })
      goOnReadingFrom = 1
    } else if (!stream1Ended && block1.data === _.nil) {
      stream1Ended = true
      if (type === 'left') { write({ b1: block0.data, key: block0.key }) }
      goOnReadingFrom = 0
    } else if (block0.key === block1.key) {
      write({ b1: block0.data, b2: block1.data, key: block0.key })
      goOnReadingFrom = type === 'right' ? 1 : 0
    } else if ((block0.key > block1.key && sortDirection === 'asc') || (block0.key < block1.key && sortDirection === 'desc') || (block0.data === _.nil && type === 'right')) {
      if (type === 'right') write({ b2: block1.data, key: block1.key })
      goOnReadingFrom = 1
    } else {
      if (type === 'left') write({ b1: block0.data, key: block0.key })
      goOnReadingFrom = 0
    }

    if (goOnReadingFrom === 0 && stream0Ended) goOnReadingFrom = 1
    else if (goOnReadingFrom === 1 && stream1Ended) goOnReadingFrom = 0
  }

  const readFrom = (s, getter) => {
    let finalRes
    const _readFrom = async () => {
      let i = s.pull()
      if (i.then) i = await i
      if (i === _.nil) return { key: undefined, data: _.nil }
      const key = getter(i)
      const res = { key, data: [i] }
      while (true) {
        i = s.pull(false)
        if (i.then) i = await i
        if (key === getter(i)) res.data.push(s.shift())
        else break
      }
      finalRes = res
      return res
    }
    const p = _readFrom()
    return finalRes || p
  }

  function * multiply ({ b1, b2, key }) {
    const x1 = !b1 ? b2 : b1
    const x2 = !b1 || !b2 ? null : b2

    for (let i = 0; i < x1.length; i++) {
      if (!x2) yield { a: x1 === b1 ? x1[i] : null, b: x1 !== b1 ? x1[i] : null, key }
      else {
        for (let j = 0; j < x2.length; j++) {
          yield { a: x1[i], b: x2[j], key }
        }
      }
    }
  }

  return new Exstream(async (write, next) => {
    try {
      if (!initialized) {
        streams = (await s.toPromise()).map(x => puller(x, buffer))
        if (streams.length !== 2) {
          write(Error('.sortedJoin() can merge only 2 exstream instances'))
          return write(_.nil)
        }
        block0 = readFrom(streams[0], getterStream0)
        block1 = readFrom(streams[1], getterStream1)
        block0 = await block0
        block1 = await block1
        if (block0.data === _.nil && type !== 'right') { streams[1].destroy(); return write(_.nil) }
        if (block1.data === _.nil && type !== 'left') { streams[0].destroy(); return write(_.nil) }
        initialized = true
        check(write)
        next()
      } else if (stream0Ended && stream1Ended) {
        write(_.nil)
      } else if (goOnReadingFrom === 0) {
        block0 = readFrom(streams[0], getterStream0)
        if (block0.then) block0 = await block0
        check(write)
        next()
      } else { // if (goOnReadingFrom === 1) {
        block1 = readFrom(streams[1], getterStream1)
        if (block1.then) block1 = await block1
        check(write)
        next()
      }
    } catch (e) {
      write(new ExstreamError(e))
      write(_.nil)
    }
  }).map(x => new Exstream(multiply(x)))
    .merge(50, true)
})
