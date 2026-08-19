const _ = require('../src/index.js')
const { nextTurn } = require('./invariant-helpers.js')
const { kAbort, kDestroy, kPause, kResume } = require('../src/stream-control.js')

test('concurrent start calls consume a manually started source exactly once', async () => {
  const source = _([1, 2, 3])
  const end = vi.fn()
  const result = source.fork(true).once('end', end).toArray()

  const firstStart = source.start()
  expect(source.start()).toBe(firstStart)
  expect(source.start()).toBe(firstStart)
  await firstStart

  expect(await result).toEqual([1, 2, 3])
  expect(end).toHaveBeenCalledTimes(1)
})

test('start is not a terminal consumer', async () => {
  const values = []
  const output = _([1, 2, 3]).tap((value) => values.push(value))

  await output.start()
  await nextTurn()

  expect(values).toEqual([])
  expect(output.paused).toBe(true)
  output[kDestroy]()
})

test('drain consumes and discards a terminal pipeline', async () => {
  const values = []

  const result = await _([1, 2, 3])
    .map((value) => value * 2)
    .tap((value) => values.push(value))
    .drain()

  expect(result).toBeUndefined()
  expect(values).toEqual([2, 4, 6])
})

test('drain waits for asynchronous work to finish', async () => {
  let release
  const pendingValue = new Promise((resolve) => {
    release = () => resolve(42)
  })
  const values = []
  let finished = false
  const draining = _([pendingValue])
    .mapAsync((value) => value)
    .tap((value) => values.push(value))
    .drain()
    .then(() => (finished = true))

  await nextTurn()
  expect(finished).toBe(false)
  expect(values).toEqual([])

  release()
  await draining

  expect(finished).toBe(true)
  expect(values).toEqual([42])
})

test('drain rejects an unhandled record error', async () => {
  const reason = Error('cannot drain this record')
  const values = []

  const output = _([1, 2, 3])
    .map((value) => {
      if (value === 2) throw reason
      return value
    })
    .tap((value) => values.push(value))
  const result = output.drain()

  await expect(result).rejects.toBe(reason)
  expect(values).toEqual([1])
  expect(output.state).toBe('aborted')
})

test('functional drain consumes a stream without collecting its values', async () => {
  const values = []

  await _([1, 2])
    .tap((value) => values.push(value))
    .drain()

  expect(values).toEqual([1, 2])
})

test('lifecycle exposes idle, running and ended states', async () => {
  const source = _()
  expect(source.state).toBe('idle')
  expect(source.ended).toBe(false)

  await source.start()
  expect(source.state).toBe('running')
  expect(source.ended).toBe(false)

  source.end()
  expect(source.state).toBe('ended')
  expect(source.ended).toBe(true)
})

test('destroy is terminal and later lifecycle calls cannot change it', async () => {
  const source = _()
  const end = vi.fn()
  source.once('end', end)

  source[kDestroy]()
  source.end()
  source[kAbort]('too late')
  source[kResume]()
  await source.start()

  expect(source.state).toBe('destroyed')
  expect(source.ended).toBe(true)
  expect(source.abortReason).toBe(null)
  expect(end).toHaveBeenCalledTimes(1)
})

test('writes after a terminal transition are rejected', () => {
  const source = _()

  source.end()

  expect(() => source.write('late value')).toThrow('Cannot write to stream after nil')
})

test('abort is idempotent and preserves the first reason', async () => {
  const source = _()
  const abort = vi.fn()
  const end = vi.fn()
  source.once('abort', abort).once('end', end)

  source[kAbort]('first reason')
  source[kAbort]('second reason')
  source[kDestroy]()
  await source.start()

  expect(source.state).toBe('aborted')
  expect(source.ended).toBe(true)
  expect(source.abortReason).toBe('first reason')
  expect(abort).toHaveBeenCalledOnce()
  expect(abort).toHaveBeenCalledWith('first reason')
  expect(end).toHaveBeenCalledOnce()
})

test('abort creates an AbortError when no reason is provided', () => {
  const source = _()

  source[kAbort]()

  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBeInstanceOf(Error)
  expect(source.abortReason.name).toBe('AbortError')
})

test('end wins over a pending start turn', async () => {
  const source = _()
  const start = source.start()

  source.end()
  await start

  expect(source.state).toBe('ended')
  expect(source.ended).toBe(true)
})

test('aborting the only transformed branch propagates to its source', () => {
  const reason = Error('stop the graph')
  const source = _([1, 2, 3])
  const transformed = source.map((value) => value * 2)

  transformed[kAbort](reason)

  expect(transformed.state).toBe('aborted')
  expect(transformed.abortReason).toBe(reason)
  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBe(reason)
})

test('aborting one reliable fork leaves a sibling attached', async () => {
  const source = _([1, 2, 3])
  const aborted = source.fork(true)
  const siblingResult = source.fork(true).toArray()

  aborted[kAbort]('branch stopped')

  expect(aborted.state).toBe('aborted')
  expect(source.state).toBe('idle')
  await source.start()
  expect(await siblingResult).toEqual([1, 2, 3])
  expect(source.state).toBe('ended')
})

test('repeated end calls flush buffered values and emit end exactly once', async () => {
  const values = []
  const end = vi.fn()
  const source = _().once('end', end)
  const sink = source.consumeSync((err, value, push) => {
    if (err) push(err)
    else if (value === _.nil) push(null, _.nil)
    else values.push(value)
  })
  sink[kResume]()

  source.write(1)
  source[kPause]()
  source.write(2)
  source.end()
  source.end()
  await nextTurn()

  expect(values).toEqual([1, 2])
  expect(end).toHaveBeenCalledTimes(1)
})

test('repeated destroy calls discard buffered values and emit end exactly once', async () => {
  const values = []
  const end = vi.fn()
  const source = _().once('end', end)
  const sink = source.consumeSync((err, value, push) => {
    if (err) push(err)
    else if (value === _.nil) push(null, _.nil)
    else values.push(value)
  })
  sink[kResume]()

  source.write(1)
  source[kPause]()
  source.write(2)
  source[kDestroy]()
  source[kDestroy]()
  source.end()
  await nextTurn()

  expect(values).toEqual([1])
  expect(end).toHaveBeenCalledTimes(1)
})

test('ending a completed stream does not restart its source or emit more events', async () => {
  const source = _([1, 2, 3])
  const end = vi.fn()
  source.once('end', end)

  expect(await source.toArray()).toEqual([1, 2, 3])
  source.end()
  source[kDestroy]()
  await source.start()
  await nextTurn()

  expect(end).toHaveBeenCalledTimes(1)
})