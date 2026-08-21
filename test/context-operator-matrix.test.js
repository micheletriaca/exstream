const _ = require('../src/index.js')
const { kResume } = require('../src/stream-control.js')

test('tap receives a lazily-created record context before a terminal drain', async () => {
  const contexts = []
  await _([1, 2])
    .tap((value, context) => {
      contexts.push({ input: context.input, signal: context.signal, value })
    })
    .drain()

  expect(contexts.map(({ input, value }) => ({ input, value }))).toEqual([
    { input: 1, value: 1 },
    { input: 2, value: 2 },
  ])
  expect(contexts.every(({ signal }) => signal instanceof AbortSignal)).toBe(true)
})

test('collect exposes aligned parent contexts before the terminal boundary', async () => {
  let aggregate
  const values = await _([1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .collect()
    .tap((value, context) => {
      aggregate = context
    })
    .single()

  expect(aggregate.input).toBe(values)
  expect(aggregate.contexts.map((parent) => parent.correlationId)).toEqual(['row-1', 'row-2'])
})

test('predicate and key callbacks receive a lazy per-record context', async () => {
  const seen = []
  const filtered = _([1, 2]).filter((value, context) => {
    seen.push(['filter', value, context.input])
    return value === 2
  })
  const stopped = await _([1, 2, 3])
    .stopWhen((value, context) => {
      seen.push(['stopWhen', value, context.input])
      return value === 2
    })
    .toArray()

  const unique = await _([1, 1, 2])
    .uniqBy((value, context) => {
      seen.push(['uniqBy', value, context.input])
      return value
    })
    .toArray()

  const grouped = _([1, 2, 3]).groupBy((value, context) => {
    seen.push(['groupBy', value, context.input])
    return value % 2
  })

  const keyed = _([1, 2]).keyBy((value, context) => {
    seen.push(['keyBy', value, context.input])
    return context.input
  })

  expect(await filtered.toArray()).toEqual([2])
  expect(stopped).toEqual([1, 2])
  expect(unique).toEqual([1, 2])
  expect(await grouped.single()).toEqual({ 0: [2], 1: [1, 3] })
  expect(await keyed.single()).toEqual({ 1: 1, 2: 2 })
  expect(seen.every(([, value, input]) => value === input)).toBe(true)
})

test('sort comparator receives both input contexts and preserves them after reordering', async () => {
  const result = await _([3, 1, 2])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .sort((left, right, leftContext, rightContext) => {
      expect(leftContext.input).toBe(left)
      expect(rightContext.input).toBe(right)
      return left - right
    })
    .map((value, context) => ({ correlationId: context.correlationId, value }))
    .toArray()

  expect(result).toEqual([
    { correlationId: 'row-1', value: 1 },
    { correlationId: 'row-2', value: 2 },
    { correlationId: 'row-3', value: 3 },
  ])
})

test('sort comparator errors retain the contexts of the compared collection', async () => {
  const errors = []
  const result = await _([2, 1])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .sort(() => {
      throw Error('cannot compare')
    })
    .errors((error, push, context) => {
      errors.push({
        correlations: context.contexts.map((parent) => parent.correlationId),
        input: context.input,
        message: error.message,
      })
    })
    .toArray()

  expect(result).toEqual([])
  expect(errors).toEqual([
    { correlations: ['row-2', 'row-1'], input: [2, 1], message: 'cannot compare' },
  ])
})

test('last preserves the context of the retained record', async () => {
  const result = await _([1, 2, 3])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .last()
    .map((value, context) => ({ correlationId: context.correlationId, value }))
    .single()

  expect(result).toEqual({ correlationId: 'row-3', value: 3 })
})

test('sortedGroupBy exposes record contexts and emits aligned aggregate contexts', async () => {
  const seen = []
  const result = await _([1, 1, 2])
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
    .toArray()

  expect(seen).toEqual([1, 1, 2])
  expect(result).toEqual([
    { inputs: [1, 1], key: 1, values: [1, 1] },
    { inputs: [2], key: 2, values: [2] },
  ])
})

test('sortedGroupBy lazily establishes contexts for a contextual selector', async () => {
  const result = await _([1, 1, 2])
    .sortedGroupBy((value, context) => {
      expect(context.input).toBe(value)
      return value
    })
    .map((group, context) => ({
      inputs: context.contexts.map((parent) => parent.input),
      key: group.key,
    }))
    .toArray()

  expect(result).toEqual([
    { inputs: [1, 1], key: 1 },
    { inputs: [2], key: 2 },
  ])
})

test('sortedJoin key callbacks receive source contexts and outputs aggregate both parents', async () => {
  const left = _([{ id: 1 }]).withContext(() => ({ source: 'left' }))
  const right = _([{ parentId: 1 }]).withContext(() => ({ source: 'right' }))
  const selectors = []

  const result = await left
    .sortedJoin(right, {
      leftKey: (value, context) => {
        selectors.push([value.id, context.source])
        return value.id
      },
      rightKey: (value, context) => {
        selectors.push([value.parentId, context.source])
        return value.parentId
      },
    })
    .map((value, context) => ({
      inputIsOutput: context.input === value,
      sources: context.contexts.map((parent) => parent.source),
      value,
    }))
    .toArray()

  expect(selectors).toContainEqual([1, 'left'])
  expect(selectors).toContainEqual([1, 'right'])
  expect(selectors.every(([key, source]) => key === 1 && ['left', 'right'].includes(source))).toBe(
    true,
  )
  expect(result).toEqual([
    {
      inputIsOutput: true,
      sources: ['left', 'right'],
      value: { left: { id: 1 }, right: { parentId: 1 }, key: 1 },
    },
  ])
})

test('sortedJoin supports a numeric key comparator', async () => {
  const comparisons = []
  const left = _([{ id: 1 }, { id: 2 }])
  const right = _([{ parentId: 2 }])

  const result = await left
    .sortedJoin(right, {
      leftKey: (value) => value.id,
      order: (leftKey, rightKey) => {
        comparisons.push([leftKey, rightKey])
        return leftKey - rightKey
      },
      rightKey: (value) => value.parentId,
    })
    .toArray()

  expect(result).toEqual([{ left: { id: 2 }, right: { parentId: 2 }, key: 2 }])
  expect(comparisons.length).toBeGreaterThan(0)
  expect(comparisons).toContainEqual([2, 2])
})

test('right sortedJoin keeps output parent contexts aligned, including unmatched records', async () => {
  const children = _([{ parentId: 1 }]).withContext(() => ({ source: 'children' }))
  const parents = _([{ id: 1 }, { id: 2 }]).withContext((value) => ({
    source: `parent-${value.id}`,
  }))

  const result = await children
    .sortedJoin(parents, {
      leftKey: (value, context) => value.parentId + Number(context.source === 'children') - 1,
      rightKey: (value, context) => value.id + Number(context.source.startsWith('parent-')) - 1,
      type: 'right',
    })
    .map((value, context) => ({
      sources: context.contexts.map((parent) => parent?.source),
      value,
    }))
    .toArray()

  expect(result).toEqual([
    {
      sources: ['children', 'parent-1'],
      value: { left: { parentId: 1 }, right: { id: 1 }, key: 1 },
    },
    {
      sources: [undefined, 'parent-2'],
      value: { left: null, right: { id: 2 }, key: 2 },
    },
  ])
})

test('sortedJoin preserves the source context of selector errors', async () => {
  const left = _([{ id: 1 }]).withContext(() => ({ source: 'left' }))
  const right = _([{ parentId: 1 }]).withContext(() => ({ source: 'right' }))
  const errors = []

  const result = await left
    .sortedJoin(right, {
      leftKey: (value) => value.id,
      rightKey: (value, context) => {
        context.stage = 'right selector'
        throw Error(`invalid ${value.parentId}`)
      },
    })
    .errors((error, push, context) => {
      errors.push({ message: error.message, source: context.source, stage: context.stage })
    })
    .toArray()

  expect(result).toEqual([])
  expect(errors).toEqual([{ message: 'invalid 1', source: 'right', stage: 'right selector' }])
})

test('new contextual callback support preserves historical unary argument lists', async () => {
  const tap = vi.fn((value) => value)
  const stopWhen = vi.fn((value) => value === 1)
  const uniqBy = vi.fn((value) => value)
  const groupBy = vi.fn((value) => value)
  const keyBy = vi.fn((value) => value)
  const toArray = vi.fn((values) => values)

  await _([1]).tap(tap).drain()
  await _([1]).stopWhen(stopWhen).toArray()
  await _([1]).uniqBy(uniqBy).toArray()
  await _([1]).groupBy(groupBy).single()
  await _([1]).keyBy(keyBy).single()
  toArray(await _([1]).toArray())

  expect(tap).toHaveBeenCalledWith(1)
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
  syncSink[kResume]()

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
  asyncSink[kResume]()
  await new Promise((resolve) => asyncSink.once('end', resolve))

  expect(syncResult).toEqual([[1, 'sync']])
  expect(asyncResult).toEqual([[2, 'async']])
})