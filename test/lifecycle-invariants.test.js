const _ = require('../src/index.js')
const { nextTurn } = require('./invariant-helpers.js')

test('concurrent start calls consume a manually started source exactly once', async () => {
  const source = _([1, 2, 3])
  const end = vi.fn()
  const result = source.fork(true).once('end', end).toPromise()

  await Promise.all([source.start(), source.start(), source.start()])

  expect(await result).toEqual([1, 2, 3])
  expect(end).toHaveBeenCalledTimes(1)
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