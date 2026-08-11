const _ = require('../src/index.js')
const { nextTurn } = require('./invariant-helpers.js')

test('concurrent start calls consume a manually started source exactly once', async () => {
  const source = _([1, 2, 3])
  const end = vi.fn()
  const result = source.fork(true).once('end', end).toPromise()

  const firstStart = source.start()
  expect(source.start()).toBe(firstStart)
  expect(source.start()).toBe(firstStart)
  await firstStart

  expect(await result).toEqual([1, 2, 3])
  expect(end).toHaveBeenCalledTimes(1)
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

  source.destroy()
  source.end()
  source.abort('too late')
  source.resume()
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

  source.abort('first reason')
  source.abort('second reason')
  source.destroy()
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

  source.abort()

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

  transformed.abort(reason)

  expect(transformed.state).toBe('aborted')
  expect(transformed.abortReason).toBe(reason)
  expect(source.state).toBe('aborted')
  expect(source.abortReason).toBe(reason)
})

test('aborting one reliable fork leaves a sibling attached', async () => {
  const source = _([1, 2, 3])
  const aborted = source.fork(true)
  const siblingResult = source.fork(true).toPromise()

  aborted.abort('branch stopped')

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
  source
    .consumeSync((err, value, push) => {
      if (err) push(err)
      else if (value === _.nil) push(null, _.nil)
      else values.push(value)
    })
    .resume()

  source.write(1)
  source.pause()
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
  source
    .consumeSync((err, value, push) => {
      if (err) push(err)
      else if (value === _.nil) push(null, _.nil)
      else values.push(value)
    })
    .resume()

  source.write(1)
  source.pause()
  source.write(2)
  source.destroy()
  source.destroy()
  source.end()
  await nextTurn()

  expect(values).toEqual([1])
  expect(end).toHaveBeenCalledTimes(1)
})

test('ending a completed stream does not restart its source or emit more events', async () => {
  const source = _([1, 2, 3])
  const end = vi.fn()
  source.once('end', end)

  expect(await source.toPromise()).toEqual([1, 2, 3])
  source.end()
  source.destroy()
  await source.start()
  await nextTurn()

  expect(end).toHaveBeenCalledTimes(1)
})