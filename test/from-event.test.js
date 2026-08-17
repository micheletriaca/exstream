const { EventEmitter } = require('events')
const _ = require('../src/index.js')
const { nextTurn } = require('./invariant-helpers.js')

test('fromEvent consumes EventEmitter payloads and unsubscribes on end', async () => {
  const emitter = new EventEmitter()
  const source = _.fromEvent(emitter, 'row')
  const result = source.toArray()

  emitter.emit('row', 1)
  emitter.emit('row', 2)
  emitter.emit('end')

  await expect(result).resolves.toEqual([1, 2])
  expect(source.received).toBe(2)
  expect(emitter.eventNames()).toEqual([])
})

test('fromEvent consumes EventTarget events through a mapper', async () => {
  const target = new EventTarget()
  const source = _.fromEvent(target, 'row', {
    end: 'complete',
    error: false,
    map: (event) => event.data,
  })
  const result = source.toArray()

  target.dispatchEvent(new MessageEvent('row', { data: 1 }))
  target.dispatchEvent(new MessageEvent('row', { data: 2 }))
  target.dispatchEvent(new Event('complete'))

  await expect(result).resolves.toEqual([1, 2])
  expect(source.received).toBe(2)
})

test('fromEvent treats Error payloads as data', async () => {
  const emitter = new EventEmitter()
  const reason = Error('business value')
  const source = _.fromEvent(emitter, 'row')
  const result = source.toArray()

  emitter.emit('row', reason)
  emitter.emit('end')

  await expect(result).resolves.toEqual([reason])
})

test('fromEvent preserves multiple EventEmitter arguments by default', async () => {
  const emitter = new EventEmitter()
  const source = _.fromEvent(emitter, 'row')
  const result = source.toArray()

  emitter.emit('row', 1, 'Ada')
  emitter.emit('end')

  await expect(result).resolves.toEqual([[1, 'Ada']])
})

test('fromEvent mapper failures abort the source and unsubscribe', async () => {
  const emitter = new EventEmitter()
  const reason = Error('invalid event payload')
  const source = _.fromEvent(emitter, 'row', {
    map() {
      throw reason
    },
  })
  const result = source.toArray()

  emitter.emit('row', 1)

  await expect(result).rejects.toBe(reason)
  expect(source.abortReason).toBe(reason)
  expect(emitter.eventNames()).toEqual([])
})

test('fromEvent maps its configured error event to a fatal graph failure', async () => {
  const emitter = new EventEmitter()
  const reason = Error('source failure')
  const source = _.fromEvent(emitter, 'row')
  const result = source.toArray()

  emitter.emit('error', reason)

  await expect(result).rejects.toBe(reason)
  expect(source.state).toBe('aborted')
  expect(emitter.eventNames()).toEqual([])
})

test('fromEvent unwraps an EventTarget error event', async () => {
  const target = new EventTarget()
  const reason = Error('wrapped target failure')
  const source = _.fromEvent(target, 'row')
  const result = source.toArray()
  const event = new Event('error')
  event.error = reason

  target.dispatchEvent(event)

  await expect(result).rejects.toBe(reason)
  expect(source.abortReason).toBe(reason)
})

test('fromEvent pauses and resumes a pausable producer with source backpressure', async () => {
  class PausableEmitter extends EventEmitter {
    pause = vi.fn()
    resume = vi.fn()
  }
  const emitter = new PausableEmitter()
  const source = _.fromEvent(emitter, 'row')

  emitter.emit('row', 1)

  expect(source.buffered).toBe(1)
  expect(emitter.pause).toHaveBeenCalledOnce()

  const result = source.toArray()
  await nextTurn()
  expect(emitter.resume).toHaveBeenCalledOnce()

  emitter.emit('row', 2)
  emitter.emit('end')
  await expect(result).resolves.toEqual([1, 2])
})

test('fromEvent pauses a pausable producer only once while its buffer remains full', async () => {
  class PausableEmitter extends EventEmitter {
    pause = vi.fn()
    resume = vi.fn()
  }
  const emitter = new PausableEmitter()
  const source = _.fromEvent(emitter, 'row', { highWaterMark: 2 })

  emitter.emit('row', 1)
  emitter.emit('row', 2)

  expect(emitter.pause).toHaveBeenCalledOnce()
  const result = source.toArray()
  emitter.emit('end')
  await expect(result).resolves.toEqual([1, 2])
})

test.each([
  ['drop-oldest', [2, 3]],
  ['drop-newest', [1, 2]],
])('fromEvent applies %s to a hot non-pausable producer', async (overflow, expected) => {
  const emitter = new EventEmitter()
  const source = _.fromEvent(emitter, 'row', { highWaterMark: 2, overflow })

  emitter.emit('row', 1)
  emitter.emit('row', 2)
  emitter.emit('row', 3)

  expect(source.received).toBe(3)
  expect(source.buffered).toBe(2)
  expect(source.peakBuffered).toBe(2)
  expect(source.dropped).toBe(1)

  const result = source.toArray()
  emitter.emit('end')
  await expect(result).resolves.toEqual(expected)
})

test('fromEvent fails a hot source that exceeds an error buffer', () => {
  const emitter = new EventEmitter()
  const source = _.fromEvent(emitter, 'row', { highWaterMark: 1 })

  emitter.emit('row', 1)
  emitter.emit('row', 2)

  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBeInstanceOf(_.BufferOverflowError)
  expect(source.abortReason.limit).toBe(1)
  expect(emitter.eventNames()).toEqual([])
})

test('fromEvent abort signal unsubscribes before later events', async () => {
  const emitter = new EventEmitter()
  const controller = new AbortController()
  const reason = Error('cancel events')
  const source = _.fromEvent(emitter, 'row', { signal: controller.signal })
  const result = source.toArray()

  emitter.emit('row', 1)
  controller.abort(reason)
  emitter.emit('row', 2)

  await expect(result).rejects.toBe(reason)
  expect(source.received).toBe(1)
  expect(emitter.eventNames()).toEqual([])
})

test('fromEvent destruction unsubscribes every source listener', () => {
  const emitter = new EventEmitter()
  const source = _.fromEvent(emitter, 'row', { end: 'complete', error: 'failed' })

  source.destroy()

  expect(emitter.eventNames()).toEqual([])
})

test('fromEvent allows end and error listeners to be disabled explicitly', async () => {
  const emitter = new EventEmitter()
  const source = _.fromEvent(emitter, 'row', { end: false, error: false })
  const result = source.toArray()

  emitter.emit('row', 1)
  source.end()

  await expect(result).resolves.toEqual([1])
  expect(emitter.eventNames()).toEqual([])
})

test('fromEvent requires bounded buffering for a non-pausable source', () => {
  const emitter = new EventEmitter()

  for (const highWaterMark of [Infinity, 'Infinity']) {
    expect(() => _.fromEvent(emitter, 'row', { highWaterMark })).toThrow(
      'requires a finite highWaterMark',
    )
  }
  expect(emitter.eventNames()).toEqual([])
})

test('fromEvent does not subscribe with a pre-aborted signal', () => {
  const emitter = new EventEmitter()
  const controller = new AbortController()
  controller.abort(Error('already cancelled'))

  const source = _.fromEvent(emitter, 'row', { signal: controller.signal })

  expect(source.state).toBe('aborted')
  expect(emitter.eventNames()).toEqual([])
})

test.each([
  [null, 'row', null],
  [{}, 'row', null],
  [new EventTarget(), 1, null],
  [new EventTarget(), 'row', []],
  [new EventTarget(), 'row', { map: true }],
])('fromEvent validates target, event, and options', (target, event, options) => {
  expect(() => _.fromEvent(target, event, options)).toThrow(/./)
})