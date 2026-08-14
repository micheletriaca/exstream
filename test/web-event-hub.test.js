test('the web runtime selects the portable event hub', async () => {
  vi.resetModules()
  require('../src/web-runtime.js')
  const { EventHub } = require('../src/event-hub.js')
  const hub = new EventHub()
  const listener = vi.fn()

  hub.on('data', listener)
  expect(hub.emit('data', 42)).toBe(true)
  expect(listener).toHaveBeenCalledWith(42)
  hub.removeAllListeners()
  expect(hub.eventNames()).toEqual([])
})