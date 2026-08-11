const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

const waitFor = async (predicate, message = 'condition was not reached') => {
  for (let turn = 0; turn < 100; turn++) {
    if (predicate()) return
    await nextTurn()
  }
  throw Error(message)
}

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

module.exports = { deferred, nextTurn, waitFor }