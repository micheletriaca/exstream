const scheduleMicrotask = (callback) => globalThis.queueMicrotask(callback)
const defaultMaxSyncExecutionTime = 1

let messageChannel
let nextMessageId = 0
const messageTasks = new Map()

const scheduleMessageTask = (callback) => {
  if (!messageChannel) {
    messageChannel = new globalThis.MessageChannel()
    messageChannel.port1.addEventListener('message', ({ data }) => {
      const task = messageTasks.get(data)
      if (!task) return
      messageTasks.delete(data)
      task()
    })
    messageChannel.port1.start()
    // MessageChannel is only reached in browsers, or in a Node-like runtime
    // without setImmediate. Do not keep that latter process alive by itself.
    messageChannel.port1.unref?.()
    messageChannel.port2.unref?.()
  }

  const id = ++nextMessageId
  messageTasks.set(id, callback)
  messageChannel.port2.postMessage(id)
  return () => messageTasks.delete(id)
}

const scheduleNextTurn = (callback) => {
  if (typeof globalThis.setImmediate === 'function') {
    const handle = globalThis.setImmediate(callback)
    return () => globalThis.clearImmediate(handle)
  }
  if (typeof globalThis.MessageChannel === 'function') return scheduleMessageTask(callback)
  const handle = globalThis.setTimeout(callback, 0)
  return () => globalThis.clearTimeout(handle)
}

const monotonicNow = () => globalThis.performance.now()

const createCooperativeScheduler = (
  maxSyncExecutionTime = defaultMaxSyncExecutionTime,
  clock = monotonicNow,
) => {
  let sliceStartedAt = null

  return (callback) => {
    const now = clock()
    if (sliceStartedAt === null) sliceStartedAt = now

    if (now - sliceStartedAt >= maxSyncExecutionTime) {
      sliceStartedAt = null
      return scheduleNextTurn(callback)
    }

    let cancelled = false
    scheduleMicrotask(() => {
      if (!cancelled) callback()
    })
    return () => {
      cancelled = true
      sliceStartedAt = null
    }
  }
}

module.exports = {
  createCooperativeScheduler,
  monotonicNow,
  scheduleMicrotask,
  scheduleNextTurn,
}