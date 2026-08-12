const _ = require('../src/index.js')

test('terminal callbacks receive a lazily-created record or aggregate context', async () => {
  const eachContexts = []
  _([1, 2]).each((value, context) => {
    eachContexts.push({ input: context.input, signal: context.signal, value })
  })

  const pulled = await new Promise((resolve, reject) => {
    _([3]).pull((error, value, context) => {
      if (error) reject(error)
      else resolve({ input: context.input, signal: context.signal, value })
    })
  })

  const collected = await new Promise((resolve) => {
    _([4, 5]).toArray((values, context) => {
      resolve({ input: context.input, signal: context.signal, values })
    })
  })

  expect(eachContexts.map(({ input, value }) => ({ input, value }))).toEqual([
    { input: 1, value: 1 },
    { input: 2, value: 2 },
  ])
  expect(eachContexts.every(({ signal }) => signal instanceof AbortSignal)).toBe(true)
  expect(pulled.input).toBe(3)
  expect(pulled.signal).toBeInstanceOf(AbortSignal)
  expect(pulled.value).toBe(3)
  expect(collected.input).toBe(collected.values)
  expect(collected.signal).toBeInstanceOf(AbortSignal)
  expect(collected.values).toEqual([4, 5])
})

test('toArray exposes aligned parent contexts when the input is already contextual', async () => {
  const context = await new Promise((resolve) => {
    _([1, 2])
      .withContext((value) => ({ correlationId: `row-${value}` }))
      .toArray((values, aggregate) => resolve({ aggregate, values }))
  })

  expect(context.aggregate.input).toBe(context.values)
  expect(context.aggregate.contexts.map((parent) => parent.correlationId)).toEqual([
    'row-1',
    'row-2',
  ])
})

test('predicate and key callbacks receive a lazy per-record context', () => {
  const seen = []
  const stopped = _([1, 2, 3])
    .stopWhen((value, context) => {
      seen.push(['stopWhen', value, context.input])
      return value === 2
    })
    .values()

  const unique = _([1, 1, 2])
    .uniqBy((value, context) => {
      seen.push(['uniqBy', value, context.input])
      return value
    })
    .values()

  const grouped = _([1, 2, 3]).groupBy((value, context) => {
    seen.push(['groupBy', value, context.input])
    return value % 2
  })

  const keyed = _([1, 2]).keyBy((value, context) => {
    seen.push(['keyBy', value, context.input])
    return context.input
  })

  expect(stopped).toEqual([1, 2])
  expect(unique).toEqual([1, 2])
  expect(grouped.value()).toEqual({ 0: [2], 1: [1, 3] })
  expect(keyed.value()).toEqual({ 1: 1, 2: 2 })
  expect(seen.every(([, value, input]) => value === input)).toBe(true)
})

test('sortBy receives both input contexts and preserves them after reordering', () => {
  const result = _([3, 1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .sortBy((left, right, leftContext, rightContext) => {
      expect(leftContext.input).toBe(left)
      expect(rightContext.input).toBe(right)
      return left - right
    })
    .map((value, context) => ({ correlationId: context.correlationId, value }))
    .values()

  expect(result).toEqual([
    { correlationId: 'row-1', value: 1 },
    { correlationId: 'row-2', value: 2 },
    { correlationId: 'row-3', value: 3 },
  ])
})

test('sortBy comparator errors retain the contexts of the compared collection', async () => {
  const errors = []
  const result = await _([2, 1])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .sortBy(() => {
      throw Error('cannot compare')
    })
    .errors((error, push, context) => {
      errors.push({
        correlations: context.contexts.map((parent) => parent.correlationId),
        input: context.input,
        message: error.message,
      })
    })
    .toPromise()

  expect(result).toEqual([])
  expect(errors).toEqual([
    { correlations: ['row-2', 'row-1'], input: [2, 1], message: 'cannot compare' },
  ])
})

test('last preserves the context of the retained record', () => {
  const result = _([1, 2, 3])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .last()
    .map((value, context) => ({ correlationId: context.correlationId, value }))
    .value()

  expect(result).toEqual({ correlationId: 'row-3', value: 3 })
})

test('sortedGroupBy exposes record contexts and emits aligned aggregate contexts', () => {
  const seen = []
  const result = _([1, 1, 2])
    .withContext((value, context) => ({ correlationId: `row-${value}-${context.input}` }))
    .sortedGroupBy((value, context) => {
      seen.push(context.input)
      return value
    })
    .map((group, context) => ({
      inputs: context.contexts.map((parent) => parent.input),
      key: group.key,
      values: group.values,
    }))
    .values()

  expect(seen).toEqual([1, 1, 2])
  expect(result).toEqual([
    { inputs: [1, 1], key: 1, values: [1, 1] },
    { inputs: [2], key: 2, values: [2] },
  ])
})

test('sortedJoin key callbacks receive source contexts and outputs aggregate both parents', async () => {
  const left = _([{ id: 1 }]).withContext(() => ({ source: 'left' }))
  const right = _([{ parentId: 1 }]).withContext(() => ({ source: 'right' }))
  const selectors = []

  const result = await _([left, right])
    .sortedJoin(
      (value, context) => {
        selectors.push([value.id, context.source])
        return value.id
      },
      (value, context) => {
        selectors.push([value.parentId, context.source])
        return value.parentId
      },
      'inner',
    )
    .map((value, context) => ({
      inputIsOutput: context.input === value,
      sources: context.contexts.map((parent) => parent.source),
      value,
    }))
    .toPromise()

  expect(selectors).toContainEqual([1, 'left'])
  expect(selectors).toContainEqual([1, 'right'])
  expect(selectors.every(([key, source]) => key === 1 && ['left', 'right'].includes(source))).toBe(
    true,
  )
  expect(result).toEqual([
    {
      inputIsOutput: true,
      sources: ['left', 'right'],
      value: { a: { id: 1 }, b: { parentId: 1 }, key: 1 },
    },
  ])
})

test('right sortedJoin keeps output parent contexts aligned, including unmatched records', async () => {
  const children = _([{ parentId: 1 }]).withContext(() => ({ source: 'children' }))
  const parents = _([{ id: 1 }, { id: 2 }]).withContext((value) => ({
    source: `parent-${value.id}`,
  }))

  const result = await _([children, parents])
    .sortedJoin(
      (value, context) => value.parentId + Number(context.source === 'children') - 1,
      (value, context) => value.id + Number(context.source.startsWith('parent-')) - 1,
      'right',
    )
    .map((value, context) => ({
      sources: context.contexts.map((parent) => parent?.source),
      value,
    }))
    .toPromise()

  expect(result).toEqual([
    {
      sources: ['children', 'parent-1'],
      value: { a: { parentId: 1 }, b: { id: 1 }, key: 1 },
    },
    {
      sources: [undefined, 'parent-2'],
      value: { a: null, b: { id: 2 }, key: 2 },
    },
  ])
})

test('sortedJoin preserves the source context of selector errors', async () => {
  const left = _([{ id: 1 }]).withContext(() => ({ source: 'left' }))
  const right = _([{ parentId: 1 }]).withContext(() => ({ source: 'right' }))
  const errors = []

  const result = await _([left, right])
    .sortedJoin(
      (value) => value.id,
      (value, context) => {
        context.stage = 'right selector'
        throw Error(`invalid ${value.parentId}`)
      },
      'inner',
    )
    .errors((error, push, context) => {
      errors.push({ message: error.message, source: context.source, stage: context.stage })
    })
    .toPromise()

  expect(result).toEqual([])
  expect(errors).toEqual([{ message: 'invalid 1', source: 'right', stage: 'right selector' }])
})

test('new contextual callback support preserves historical unary argument lists', async () => {
  const each = vi.fn((value) => value)
  const stopWhen = vi.fn((value) => value === 1)
  const uniqBy = vi.fn((value) => value)
  const groupBy = vi.fn((value) => value)
  const keyBy = vi.fn((value) => value)
  const toArray = vi.fn((values) => values)

  _([1]).each(each)
  _([1]).stopWhen(stopWhen).values()
  _([1]).uniqBy(uniqBy).values()
  _([1]).groupBy(groupBy).value()
  _([1]).keyBy(keyBy).value()
  await new Promise((resolve) =>
    _([1]).toArray((values) => {
      toArray(values)
      resolve()
    }),
  )

  expect(each).toHaveBeenCalledWith(1)
  expect(stopWhen).toHaveBeenCalledWith(1)
  expect(uniqBy).toHaveBeenCalledWith(1)
  expect(groupBy).toHaveBeenCalledWith(1)
  expect(keyBy).toHaveBeenCalledWith(1)
  expect(toArray).toHaveBeenCalledWith([1])
})

test('low-level consume callbacks retain their explicit context arguments', async () => {
  const sync = _([1]).withContext(() => ({ correlationId: 'sync' }))
  let syncSink
  const syncResult = []
  syncSink = sync.consumeSync((error, value, push, context) => {
    if (error) throw error
    if (value === _.nil) push(null, _.nil)
    else syncResult.push([value, context.correlationId])
  })
  syncSink.resume()

  const asyncResult = []
  const asyncSink = _([2])
    .withContext(() => ({ correlationId: 'async' }))
    .consume((error, value, push, next, context) => {
      if (error) throw error
      if (value === _.nil) push(null, _.nil)
      else {
        asyncResult.push([value, context.correlationId])
        next()
      }
    })
  asyncSink.resume()
  await new Promise((resolve) => asyncSink.once('end', resolve))

  expect(syncResult).toEqual([[1, 'sync']])
  expect(asyncResult).toEqual([[2, 'async']])
})