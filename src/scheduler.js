const scheduleMicrotask = (callback) => globalThis.queueMicrotask(callback)

const scheduleNextTurn = (callback) => {
  if (typeof globalThis.setImmediate === 'function') {
    const handle = globalThis.setImmediate(callback)
    return () => globalThis.clearImmediate(handle)
  }
  const handle = globalThis.setTimeout(callback, 0)
  return () => globalThis.clearTimeout(handle)
}

const monotonicNow = () => globalThis.performance.now()

module.exports = { monotonicNow, scheduleMicrotask, scheduleNextTurn }