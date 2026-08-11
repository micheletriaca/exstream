const _ = require('../src/index.js')
const { ExstreamError } = require('../src/exstream.js')

test('errors without consumers are emitted by the source stream', () => {
  const source = _()
  const reason = Error('unhandled stream error')
  const error = vi.fn()
  source.once('error', error)
  source.resume()

  source.write(reason)

  expect(error).toHaveBeenCalledOnce()
  expect(error).toHaveBeenCalledWith(reason)
})

test('normalized error-like objects preserve their supplied stack', () => {
  const reason = { message: 'remote failure', stack: 'remote stack' }
  const wrapped = new ExstreamError(reason, 'input')

  expect(wrapped).toBeInstanceOf(Error)
  expect(wrapped.message).toBe('remote failure')
  expect(wrapped.stack).toBe('remote stack')
  expect(wrapped.reason).toBe(reason)
  expect(wrapped.exstreamInput).toBe('input')
})

test('synchronous values rethrows an error record unchanged', () => {
  const reason = Error('synchronous failure')

  expect(() => _([reason]).values()).toThrow(reason)
})