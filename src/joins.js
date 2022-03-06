/* eslint-disable no-nested-ternary */
/* eslint-disable max-statements */
/* eslint-disable no-use-before-define */
/* eslint-disable complexity */
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
  let s1Transform, s2Transform
  let w, n, pullData, a, b
  let s2Started = false, cb1, cb2

  const endBranch = idx => {
    if(idx === 0) b1Ended = true
    if(idx === 1) b2Ended = true
    const overallEnded = type === 'inner' && (b1Ended || b2Ended) || b1Ended
    if(!overallEnded) n()
    else w(_.nil)
  }

  const multiplyAndWrite = (a, b, w, key) => {
    if(type === 'right') {
      for(const x of a.values) {
        w({ key, a: b, b: x })
      }
    } else {
      for(const x of a.values) {
        w({ key, a: x, b })
      }
    }
  }

  s.toPromise().then(subStreams => {
    if (subStreams.length !== 2) {
      throw Error('.sortedJoin() can merge only 2 exstream instances')
    }
    const bufferPipeline = buffer !== 1 ? _a.pipeline().batch(buffer).flatten() : null

    const s1 = type === 'right' ? subStreams[1] : subStreams[0]
    const s2 = type === 'right' ? subStreams[0] : subStreams[1]

    s1Transform = s1
      .through(bufferPipeline)
      .sortedGroupBy(masterFn)
      .consume((err, x, push, cb) => {
        cb1 = cb
        if(err) {
          pullData = cb1
          a = null
          w(err)
          n()
        } else if(x === _.nil) {
          pullData = cb2
          endBranch(0)
        } else {
          a = x
          try {
            const bKey = b && getterSlave(b)
            if(a.key === bKey) {
              multiplyAndWrite(a, b, w, a.key)
              pullData = cb2
            } else if(b) {
              const goOnFetchingFromA =
                b2Ended
                || bKey > a.key && sortDirection === 'asc'
                || bKey < a.key && sortDirection === 'desc'

              if(goOnFetchingFromA && type !== 'inner') multiplyAndWrite(a, null, w, a.key)

              pullData = goOnFetchingFromA ? cb1 : cb2
            } else {
              if(b2Ended && type !== 'inner') multiplyAndWrite(a, null, w, a.key)
              pullData = b2Ended ? cb1 : cb2
            }

            if(!s2Started) {
              pullData = () => s2Transform.resume()
              s2Started = true
            }

            n()
          } catch(e) {
            w(new ExstreamError(e, x))
            n()
          }
        }
      })

    s2Transform = s2
      .through(bufferPipeline)
      .consume((err, x, push, cb) => {
        cb2 = cb
        if(err) {
          pullData = cb2
          b = null
          w(err)
          n()
        } else if(x === _.nil) {
          pullData = cb1
          const bKey = b && getterSlave(b)
          const shouldEmit =
            a && (
              b === void 0
              || bKey < a.key && sortDirection === 'asc'
              || bKey > a.key && sortDirection === 'desc'
            )
          if(shouldEmit && type !== 'inner') multiplyAndWrite(a, null, w, a.key)
          endBranch(1)
        } else {
          try {
            b = x
            const bKey = b && getterSlave(b)
            if(a.key === bKey) {
              multiplyAndWrite(a, b, w, bKey)
              pullData = cb2
            } else {
              const goOnFetchingFromB =
                bKey < a.key && sortDirection === 'asc'
                || bKey > a.key && sortDirection === 'desc'

              pullData = goOnFetchingFromB ? cb2 : cb1
            }

            n()
          } catch(e) {
            w(new ExstreamError(e, x))
            n()
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
  }).on('end', () => {
    w = n = () => {} // eslint-disable-line no-empty-function
    s1Transform.destroy()
    s2Transform.destroy()
    w = n = pullData = a = b = cb1 = cb2 = null
  })
})
