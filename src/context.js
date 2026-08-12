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

const setContextSignal = (context, signal) => {
  context[contextSignal] = signal
  return context
}

const appendContext = (contexts, context, previousCount) => {
  if (context === void 0) {
    if (contexts) contexts.push(void 0)
    return contexts
  }
  if (!contexts) contexts = Array(previousCount)
  contexts.push(context)
  return contexts
}

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
  appendContext,
  assignContext,
  createContext,
  forkContext,
  setContextSignal,
}