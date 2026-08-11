const contextSignal = Symbol('exstream context signal')

class RecordContext {
  constructor(input, signal) {
    this.input = input
    this[contextSignal] = signal
  }

  get signal() {
    return this[contextSignal]
  }
}

const createContext = (input, signal) => new RecordContext(input, signal)

const aggregateContexts = (input, contexts, signal) => {
  const aggregate = createContext(input, signal)
  aggregate.contexts = contexts
  return aggregate
}

const forkContext = (context, signal) => {
  const forked = new RecordContext(context.input, signal)
  for (const key of Object.keys(context)) forked[key] = context[key]
  return forked
}

const assignContext = (context, additions) => {
  if (additions === void 0) return context
  if (!additions || typeof additions !== 'object' || Array.isArray(additions)) {
    throw Error('context initializer must return an object or undefined')
  }
  if (Object.hasOwn(additions, 'signal')) throw Error('context signal is managed by Exstream')
  return Object.assign(context, additions)
}

module.exports = {
  aggregateContexts,
  assignContext,
  createContext,
  forkContext,
}