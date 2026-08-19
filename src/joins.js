const { Exstream, ExstreamError } = require('./exstream')
const { aggregateContexts, appendContext, createContext } = require('./context')
const { dataFrame, errorFrame } = require('./protocol.js')
const { kDestroy, kResume } = require('./stream-control.js')

const _ = require('./utils.js')
const _a = require('./methods')
const _m = (module.exports = {})

_m.sortedGroupBy = _.curry((fnOrString, s) => {
  const getter = _.isString(fnOrString) ? _.makeGetter(fnOrString) : fnOrString
  const usesContext = !_.isString(fnOrString) && getter.length >= 2
  let currentBatch = []
  let currentContexts
  let currentKey = _.nil
  let result

  const flush = (push) => {
    const group = { key: currentKey, values: currentBatch }
    push(
      null,
      group,
      currentContexts === void 0
        ? void 0
        : aggregateContexts(group, currentContexts, result.signal),
    )
  }

  result = s.consumeSync((err, x, push) => {
    if (err) push(err)
    else if (x === _.nil) {
      if (currentBatch.length) flush(push)
      currentBatch = null
      currentContexts = null
      push(null, _.nil)
    } else {
      const context = result._recordContext
      const nextContext =
        usesContext && context === void 0 ? createContext(x, result.signal) : context
      try {
        const k = usesContext ? getter(x, nextContext) : getter(x)
        if (currentKey !== k) {
          if (currentKey !== _.nil) flush(push)
          currentBatch = [x]
          currentContexts = appendContext(void 0, nextContext, 0)
          currentKey = k
        } else {
          currentContexts = appendContext(currentContexts, nextContext, currentBatch.length)
          currentBatch.push(x)
        }
      } catch (e) {
        push(new ExstreamError(e, x), null, nextContext)
      }
    }
  })
  return result
})

_m.sortedJoin = _.curry((joinKeyOrFnA, joinKeyOrFnB, type, sortDirection, buffer, s) => {
  buffer = _.asPositiveInteger(buffer)
  if (buffer === null) {
    throw Error('error in .sortedJoin(). buffer must be a positive integer')
  }
  const slaveFn = type === 'right' ? joinKeyOrFnA : joinKeyOrFnB
  const masterFn = type === 'right' ? joinKeyOrFnB : joinKeyOrFnA
  const getterSlave = _.isString(slaveFn) ? _.makeGetter(slaveFn) : slaveFn
  const usesSlaveContext = !_.isString(slaveFn) && getterSlave.length >= 2
  const usesSortContext = _.isFunction(sortDirection) && sortDirection.length >= 3

  let b1Ended = false,
    b2Ended = false
  let s1Transform, s2Transform
  let pullData, a, b, bKey, aContext, bContext, result
  let s2Started = false,
    cb1,
    cb2
  const frames = []
  let outputRequest = null
  let outputEnded = false
  let setupStarted = false

  const pump = () => {
    if (!outputRequest) return
    if (frames.length) {
      const request = outputRequest
      outputRequest = null
      request.resolve({ done: false, value: frames.shift() })
      return
    }
    if (outputEnded) {
      const request = outputRequest
      outputRequest = null
      request.resolve({ done: true, value: void 0 })
      return
    }
    if (pullData) {
      const pull = pullData
      pullData = null
      pull()
    }
  }

  const enqueue = (frame) => {
    frames.push(frame)
    pump()
  }

  const endBranch = (idx) => {
    if (idx === 0) b1Ended = true
    if (idx === 1) b2Ended = true
    const overallEnded = (type === 'inner' && (b1Ended || b2Ended)) || b1Ended
    if (overallEnded) outputEnded = true
    pump()
  }

  const selectSlaveKey = () => b && (usesSlaveContext ? getterSlave(b, bContext) : getterSlave(b))

  const compareKeys = (left, right) =>
    usesSortContext ? sortDirection(left, right, aContext, bContext) : sortDirection(left, right)

  const multiplyAndWrite = (a, b, key) => {
    const masterContexts = aContext && aContext.contexts
    if (type === 'right') {
      for (let index = 0; index < a.values.length; index++) {
        const value = { key, a: b, b: a.values[index] }
        const parents = [
          b === null ? void 0 : bContext,
          masterContexts ? masterContexts[index] : aContext,
        ]
        const context = parents.every((parent) => parent === void 0)
          ? void 0
          : aggregateContexts(value, parents, result.signal)
        enqueue(dataFrame(value, context))
      }
    } else {
      for (let index = 0; index < a.values.length; index++) {
        const value = { key, a: a.values[index], b }
        const parents = [
          masterContexts ? masterContexts[index] : aContext,
          b === null ? void 0 : bContext,
        ]
        const context = parents.every((parent) => parent === void 0)
          ? void 0
          : aggregateContexts(value, parents, result.signal)
        enqueue(dataFrame(value, context))
      }
    }
  }

  const startSetup = () => {
    if (setupStarted) return
    setupStarted = true
    s.toArray()
      .then((subStreams) => {
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
            if (err) {
              pullData = cb1
              aContext = s1Transform._recordContext
              a = null
              enqueue(errorFrame(err, err.exstreamInput, false, aContext))
              pump()
            } else if (x === _.nil) {
              pullData = cb2
              endBranch(0)
            } else {
              a = x
              aContext = s1Transform._recordContext
              if (usesSortContext && aContext === void 0) {
                aContext = createContext(a, s1Transform.signal)
              }
              try {
                if (a.key === bKey) {
                  multiplyAndWrite(a, b, a.key)
                  pullData = cb2
                } else if (b) {
                  const goOnFetchingFromA =
                    b2Ended ||
                    (_.isFunction(sortDirection) && !compareKeys(a.key, bKey)) ||
                    (bKey > a.key && sortDirection === 'asc') ||
                    (bKey < a.key && sortDirection === 'desc')

                  if (goOnFetchingFromA && type !== 'inner') multiplyAndWrite(a, null, a.key)

                  pullData = goOnFetchingFromA ? cb1 : cb2
                } else {
                  if (b2Ended && type !== 'inner') multiplyAndWrite(a, null, a.key)
                  pullData = b2Ended ? cb1 : cb2
                }

                if (!s2Started) {
                  pullData = () => s2Transform[kResume]()
                  s2Started = true
                }

                pump()
              } catch (e) {
                pullData = cb1
                const error = new ExstreamError(e, x)
                enqueue(errorFrame(error, error.exstreamInput, false, aContext))
                pump()
              }
            }
          })

        s2Transform = s2.through(bufferPipeline).consume((err, x, push, cb) => {
          cb2 = cb
          if (err) {
            pullData = cb2
            bContext = s2Transform._recordContext
            b = null
            enqueue(errorFrame(err, err.exstreamInput, false, bContext))
            pump()
          } else if (x === _.nil) {
            pullData = cb1
            const shouldEmit =
              a &&
              (b === void 0 ||
                (_.isFunction(sortDirection) && compareKeys(a.key, bKey)) ||
                (bKey < a.key && sortDirection === 'asc') ||
                (bKey > a.key && sortDirection === 'desc'))
            if (shouldEmit && type !== 'inner') multiplyAndWrite(a, null, a.key)
            endBranch(1)
          } else {
            try {
              b = x
              bContext = s2Transform._recordContext
              if ((usesSlaveContext || usesSortContext) && bContext === void 0) {
                bContext = createContext(b, s2Transform.signal)
              }
              bKey = selectSlaveKey()
              if (a.key === bKey) {
                multiplyAndWrite(a, b, bKey)
                pullData = cb2
              } else {
                const goOnFetchingFromB =
                  (_.isFunction(sortDirection) && compareKeys(a.key, bKey)) ||
                  (bKey < a.key && sortDirection === 'asc') ||
                  (bKey > a.key && sortDirection === 'desc')

                pullData = goOnFetchingFromB ? cb2 : cb1
              }

              pump()
            } catch (e) {
              pullData = cb2
              const error = new ExstreamError(e, x)
              enqueue(errorFrame(error, error.exstreamInput, false, bContext))
              b = bKey = void 0
              pump()
            }
          }
        })

        pullData = () => s1Transform[kResume]()
        pump()
        return void 0
      })
      .catch((e) => {
        const error = new ExstreamError(e, void 0, { origin: 'operator', stage: 'sortedJoin' })
        enqueue(errorFrame(error))
        outputEnded = true
        pump()
      })
  }

  const output = {
    next() {
      if (outputEnded && frames.length === 0) {
        return Promise.resolve({ done: true, value: void 0 })
      }
      startSetup()
      if (frames.length) return Promise.resolve({ done: false, value: frames.shift() })
      return new Promise((resolve) => {
        outputRequest = { resolve }
        pump()
      })
    },
    return(value) {
      outputEnded = true
      frames.length = 0
      if (outputRequest) {
        outputRequest.resolve({ done: true, value })
        outputRequest = null
      }
      if (s1Transform) s1Transform[kDestroy]()
      if (s2Transform) s2Transform[kDestroy]()
      return Promise.resolve({ done: true, value })
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }

  result = Exstream.fromFrames(output).on('end', () => {
    if (s1Transform) s1Transform[kDestroy]()
    if (s2Transform) s2Transform[kDestroy]()
    outputRequest = null
    pullData = a = b = bKey = aContext = bContext = cb1 = cb2 = null
  })
  return result
})