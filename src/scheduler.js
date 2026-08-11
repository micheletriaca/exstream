const scheduleMicrotask = (callback) => globalThis.queueMicrotask(callback)

const scheduleNextTurn = (callback) => {
  if (typeof globalThis.setImmediate === 'function') return globalThis.setImmediate(callback)
  return globalThis.setTimeout(callback, 0)
}

const monotonicNow = () => globalThis.performance.now()

module.exports = { monotonicNow, scheduleMicrotask, scheduleNextTurn }