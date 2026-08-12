const { runtime } = require('./runtime.js')

/* v8 ignore start -- The portable hub is exercised by the separate headless browser harness. */
class PortableEventHub extends runtime.EventBase {
  #events = new Map()

  on(event, listener) {
    const listeners = this.#events.get(event)
    if (listeners) listeners.push(listener)
    else this.#events.set(event, [listener])
    return this
  }

  once(event, listener) {
    const once = (...args) => {
      this.off(event, once)
      listener.apply(this, args)
    }
    once.listener = listener
    return this.on(event, once)
  }

  off(event, listener) {
    const listeners = this.#events.get(event)
    if (!listeners) return this
    const remaining = listeners.filter(
      (candidate) => candidate !== listener && candidate.listener !== listener,
    )
    if (remaining.length) this.#events.set(event, remaining)
    else this.#events.delete(event)
    return this
  }

  emit(event, ...args) {
    const listeners = this.#events.get(event)
    if (!listeners || listeners.length === 0) {
      if (event === 'error') throw args[0]
      return false
    }
    for (const listener of listeners.slice()) listener.apply(this, args)
    return true
  }

  listenerCount(event) {
    return this.#events.get(event)?.length || 0
  }

  eventNames() {
    return [...this.#events.keys()]
  }

  removeAllListeners(event) {
    if (event === void 0) this.#events.clear()
    else this.#events.delete(event)
    return this
  }

  setMaxListeners() {
    return this
  }
}
/* v8 ignore stop */

const EventHub = runtime.platform === 'node' ? runtime.EventBase : PortableEventHub

module.exports = { EventHub }