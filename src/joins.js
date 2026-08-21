const { Exstream, ExstreamError } = require('./exstream')
const { aggregateContexts, appendContext, createContext } = require('./context')
const { kAbort, kDestroy, kFail, kResume } = require('./stream-control.js')

const _ = require('./utils.js')
const _m = (module.exports = {})

const createSortedGroups = (fnOrString, s, compare = null) => {
  const getter = _.isString(fnOrString) ? _.makeGetter(fnOrString) : fnOrString
  const usesContext = !_.isString(fnOrString) && getter.length >= 2
  let currentBatch = []
  let currentContexts
  let currentKey = _.nil
  let hasCurrent = false
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
      if (hasCurrent) flush(push)
      currentBatch = null
      currentContexts = null
      hasCurrent = false
      push(null, _.nil)
    } else {
      const context = result._recordContext
      const nextContext =
        usesContext && context === void 0 ? createContext(x, result.signal) : context
      try {
        const k = usesContext ? getter(x, nextContext) : getter(x)
        const sameKey = hasCurrent && (compare ? compare(currentKey, k) === 0 : currentKey === k)
        if (!sameKey) {
          if (hasCurrent) flush(push)
          currentBatch = [x]
          currentContexts = appendContext(void 0, nextContext, 0)
          currentKey = k
          hasCurrent = true
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
}

_m.sortedGroupBy = _.curry((fnOrString, s) => createSortedGroups(fnOrString, s))

const joinTypes = new Set(['inner', 'left', 'right'])

const createSelector = (selector, name) => {
  if (_.isFunction(selector)) return { get: selector, usesContext: selector.length >= 2 }
  if (_.isString(selector)) return { get: _.makeGetter(selector), usesContext: false }
  if (typeof selector === 'number' || typeof selector === 'symbol') {
    return { get: (value) => value[selector], usesContext: false }
  }
  throw Error(`error in .sortedJoin(). ${name} must be a function or property key`)
}

const createComparator = (order) => {
  if (order !== 'asc' && order !== 'desc' && !_.isFunction(order)) {
    throw Error("error in .sortedJoin(). order must be 'asc', 'desc', or a comparator")
  }
  const descending = order === 'desc'
  const compare = _.isFunction(order)
    ? order
    : (left, right) => {
        if (left < right) return descending ? 1 : -1
        if (left > right) return descending ? -1 : 1
        return 0
      }
  return (left, right) => {
    const comparison = compare(left, right)
    if (typeof comparison !== 'number' || Number.isNaN(comparison)) {
      throw Error('error in .sortedJoin(). the order comparator must return a number')
    }
    return comparison === 0 ? 0 : comparison < 0 ? -1 : 1
  }
}

const operatorError = (reason, input) =>
  new ExstreamError(reason, input, { origin: 'operator', stage: 'sortedJoin' })

const sortedJoin = (left, right, options) => {
  if (!_.isExstream(right)) throw Error('error in .sortedJoin(). right must be an Exstream')
  if (left === right) {
    throw Error('error in .sortedJoin(). left and right must be different Exstream instances')
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw Error('error in .sortedJoin(). options must be an object')
  }
  const type = options.type === void 0 ? 'inner' : options.type
  if (!joinTypes.has(type)) {
    throw Error("error in .sortedJoin(). type must be 'inner', 'left', or 'right'")
  }
  const leftSelector = createSelector(options.leftKey, 'leftKey')
  const rightSelector = createSelector(options.rightKey, 'rightKey')
  const compare = createComparator(options.order === void 0 ? 'asc' : options.order)
  // Group only the preserved side; the other side stays at one record while matches are emitted.
  const masterIsRight = type === 'right'
  const masterStream = masterIsRight ? right : left
  const slaveStream = masterIsRight ? left : right
  const masterSelector = masterIsRight ? options.rightKey : options.leftKey
  const slaveSelector = masterIsRight ? leftSelector : rightSelector
  let masterSink, slaveSink
  let master, slave
  let masterError, slaveError
  let masterNext, slaveNext
  let emission, resumeAfterWrite
  let masterEnded = false
  let slaveEnded = false
  let masterMatched = false
  let started = false
  let pumping = false
  let cleaning = false
  let result

  const contextFor = (value, leftContext, rightContext) => {
    if (leftContext === void 0 && rightContext === void 0) return void 0
    return aggregateContexts(value, [leftContext, rightContext], result.signal)
  }

  const advanceMaster = () => {
    const next = masterNext
    master = masterNext = null
    masterMatched = false
    if (next) next()
  }

  const advanceSlave = () => {
    const next = slaveNext
    slave = slaveNext = null
    if (next) next()
  }

  const writeError = (pending, afterWrite) => {
    result._writeError(pending.error, pending.context)
    if (result.ended) return
    if (result.paused) resumeAfterWrite = afterWrite
    else afterWrite()
  }

  const writeEmission = () => {
    const index = emission.index++
    const masterContexts = master.context && master.context.contexts
    const masterRecord = {
      context: masterContexts ? masterContexts[index] : master.context,
      value: master.group.values[index],
    }
    const slaveRecord = emission.matched ? slave : null
    const leftRecord = masterIsRight ? slaveRecord : masterRecord
    const rightRecord = masterIsRight ? masterRecord : slaveRecord
    const value = {
      key: slaveRecord && masterIsRight ? slaveRecord.key : master.group.key,
      left: leftRecord ? leftRecord.value : null,
      right: rightRecord ? rightRecord.value : null,
    }
    result._writeData(
      value,
      false,
      contextFor(value, leftRecord && leftRecord.context, rightRecord && rightRecord.context),
    )
    if (emission.index !== master.group.values.length) return

    const matched = emission.matched
    emission = null
    const complete = matched
      ? () => {
          masterMatched = true
          advanceSlave()
        }
      : advanceMaster
    if (result.paused) resumeAfterWrite = complete
    else complete()
  }

  const pump = () => {
    if (pumping || result.paused || result.ended) return
    pumping = true
    try {
      while (!result.paused && !result.ended) {
        if (resumeAfterWrite) {
          const resume = resumeAfterWrite
          resumeAfterWrite = null
          resume()
        } else if (masterError) {
          const pending = masterError
          masterError = null
          writeError(pending, pending.next)
        } else if (slaveError) {
          const pending = slaveError
          slaveError = null
          writeError(pending, pending.next)
        } else if (emission) {
          writeEmission()
        } else if (!master && masterEnded) {
          result.end()
        } else if (slaveEnded) {
          if (type === 'inner') result.end()
          else if (!master) break
          else if (masterMatched) advanceMaster()
          else emission = { index: 0, matched: false }
        } else if (!master || !slave) {
          break
        } else {
          let comparison
          try {
            comparison = masterIsRight
              ? compare(slave.key, master.group.key)
              : compare(master.group.key, slave.key)
          } catch (reason) {
            const pending = { error: operatorError(reason, void 0), context: void 0 }
            writeError(pending, () => result.end())
            continue
          }
          if (comparison === 0) emission = { index: 0, matched: true }
          else if (comparison < 0 !== masterIsRight) {
            if (type === 'inner' || masterMatched) advanceMaster()
            else emission = { index: 0, matched: false }
          } else advanceSlave()
        }
      }
    } finally {
      pumping = false
    }
  }

  result = new Exstream()
  const groupedMaster = createSortedGroups(masterSelector, masterStream, compare)
  masterSink = groupedMaster.consume((error, value, push, next) => {
    if (result.ended) return
    if (error) {
      masterError = { context: masterSink._recordContext, error, next }
    } else if (value === _.nil) {
      masterEnded = true
      push(null, _.nil)
    } else {
      master = { context: masterSink._recordContext, group: value }
      masterNext = next
    }
    pump()
  })
  slaveSink = slaveStream.consume((error, value, push, next) => {
    if (result.ended) return
    let context = slaveSink._recordContext
    if (error) {
      slaveError = { context, error, next }
    } else if (value === _.nil) {
      slaveEnded = true
      push(null, _.nil)
    } else {
      if (slaveSelector.usesContext && context === void 0) {
        context = createContext(value, result.signal)
      }
      try {
        const key = slaveSelector.usesContext
          ? slaveSelector.get(value, context)
          : slaveSelector.get(value)
        slave = { context, key, value }
        slaveNext = next
      } catch (reason) {
        slaveError = { context, error: operatorError(reason, value), next }
      }
    }
    pump()
  })

  const fail = (error, input) => {
    if (!cleaning && !result.ended) result[kFail](error, input)
  }
  const abort = (reason) => {
    if (!cleaning && !result.ended) result[kAbort](reason)
  }
  masterSink.once('fatal', fail).once('abort', abort)
  slaveSink.once('fatal', fail).once('abort', abort)
  result.on('drain', () => {
    if (!started) {
      started = true
      masterSink[kResume]()
      if (!result.ended) slaveSink[kResume]()
    }
    pump()
  })
  result.once('abort', (reason) => {
    cleaning = true
    if (!masterSink.ended) masterSink[kAbort](reason)
    if (!slaveSink.ended) slaveSink[kAbort](reason)
  })
  result.once('end', () => {
    cleaning = true
    if (!masterSink.ended) masterSink[kDestroy]()
    if (!slaveSink.ended) slaveSink[kDestroy]()
    master = slave = masterError = slaveError = emission = resumeAfterWrite = null
    masterNext = slaveNext = null
  })
  return result
}

Object.defineProperty(_m, 'sortedJoin', { value: sortedJoin })