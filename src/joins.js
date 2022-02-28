/* eslint-disable no-nested-ternary */
/* eslint-disable max-lines */
/* eslint-disable no-sync */
/* eslint-disable max-statements */
/* eslint-disable no-use-before-define */
/* eslint-disable complexity */
/* eslint-disable max-len */
/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable max-statements-per-line */
/* eslint-disable promise/always-return */
/* eslint-disable max-lines-per-function */

const { Exstream, ExstreamError } = require('./exstream')

const _ = require('./utils.js')
const _a = require('./methods')
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
          if(currentKey !== _.nil) push(null, { key: currentKey, values: currentBatch })
          currentBatch = [x]
          currentKey = k
        } else {
          currentBatch.push(x)
        }
      }catch(e) {
        push(new ExstreamError(e, x))
      }
    }
  })
})

_m.sortedJoin = _.curry((joinKeyOrFnA, joinKeyOrFnB, type, sortDirection, buffer, s) => {
  const slaveFn = type === 'right' ? joinKeyOrFnA : joinKeyOrFnB
  const masterFn = type === 'right' ? joinKeyOrFnB : joinKeyOrFnA
  const getterSlave = _.isString(slaveFn) ? _.makeGetter(slaveFn) : slaveFn

  let b1Ended = false, b2Ended = false
  let w, n, pullData, a, b
  let s2Started = false, cb1, cb2

  const endBranch = idx => {
    if(idx === 0) b1Ended = true
    if(idx === 1) b2Ended = true
    const overallEnded = type === 'inner' && (b1Ended || b2Ended) || b1Ended
    if(!overallEnded) return n()
    w(_.nil)
    w = n = pullData = a = b = cb1 = cb2 = null
  }

  const multiplyAndWrite = (a, b, w, key) => {
    if(type === 'right') {
      for(const x of a.values) {
        w({key, a: b, b: x})
      }
    } else {
      for(const x of a.values) {
        w({key, a: x, b})
      }
    }
  }

  s.collect().toPromise().then(subStreams => {
    if (subStreams[0].length !== 2) { throw Error('.sortedLeftJoin() can merge EXACTLY 2 exstream instances') }
    const bufferPipeline = buffer !== 1 ? _a.pipeline().batch(buffer).flatten() : null

    const s1 = type === 'right' ? subStreams[0][1] : subStreams[0][0]
    const s2 = type === 'right' ? subStreams[0][0] : subStreams[0][1]

    const s1Transform = s1
      .through(bufferPipeline)
      .sortedGroupBy(masterFn)
      .consume((err, x, push, cb) => {
        if(err) {
          w(err)
          n()
        } else if(x === _.nil) {
          pullData = cb2
          endBranch(0)
        } else {
          cb1 = cb
          a = x
          try {
            const bKey = b && getterSlave(b)
            if(a.key === bKey) {
              multiplyAndWrite(a, b, w, bKey)
              pullData = b2Ended ? cb1 : cb2
            } else if(b) {
              if(type !== 'inner') multiplyAndWrite(a, null, w, a.key)
              const goOnFetchingFromA =
                bKey > a.key && sortDirection === 'asc'
                || bKey < a.key && sortDirection === 'desc'

              pullData = goOnFetchingFromA ? cb1 : cb2
            } else {
              pullData = b2Ended ? cb1 : cb2
            }

            if(!s2Started) {
              pullData = () => s2Transform.resume()
              s2Started = true
            }

            n()
          } catch(e) {
            w(new ExstreamError(e, x))
            w(_.nil)
          }
        }
      })

    const s2Transform = s2
      .through(bufferPipeline)
      .consume((err, x, push, cb) => {
        if(err) {
          w(err)
          n()
        } else if(x === _.nil) {
          pullData = cb1
          endBranch(1)
        } else {
          try {
            cb2 = cb
            b = x
            const bKey = b && getterSlave(b)
            if(a.key === bKey) {
              multiplyAndWrite(a, b, w, bKey)
              pullData = cb2
            } else {
              const goOnFetchingFromB =
                bKey < a.key && sortDirection === 'asc'
                || bKey > a.key && sortDirection === 'desc'

              pullData = goOnFetchingFromB ? cb2 : b1Ended ? cb2 : cb1
            }

            n()
          } catch(e) {
            w(new ExstreamError(e, x))
            w(_.nil)
          }
        }
      })

    pullData = () => s1Transform.resume()
    n && n()
  }).catch(e => {
    pullData = () => { w(e); w(_.nil) }
    if(w) pullData()
  })

  return new Exstream((write, next) => {
    w = write
    n = next
    if(pullData) pullData()
  })
})
