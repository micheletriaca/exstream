jest.setTimeout(500)

const _ = require('../src/index.js')

test('unordered promises', async () => {
  let sleepCount = 3
  const sleep = x => new Promise(resolve => setTimeout(() => resolve(x), 10 * sleepCount--))

  const res = await _([2, 3, 4])
    .map(x => sleep(x))
    .massThen(x => x * 2)
    .massThen(x => x * 2)
    .resolve(2, false)
    .toPromise()

  expect(res).toEqual([12, 8, 16])
})

test('ordered promises', async () => {
  let sleepCount = 3
  const decrementalSlowMap = x =>
    new Promise(resolve => setTimeout(() => resolve(x), 10 * sleepCount--))

  const res = await _([2, 3, 4])
    .map(x => decrementalSlowMap(x))
    .massThen(x => x * 2)
    .massThen(x => x * 2)
    .resolve(3)
    .toPromise()

  expect(res).toEqual([8, 12, 16])
})

test('promises hl style', async () => {
  let sleepCount = 3
  const sleep = x => new Promise(resolve => setTimeout(() => resolve(x), 10 * sleepCount--))

  const res = await _([2, 3, 4])
    .map(x => _(sleep(x)))
    .merge(3, true)
    .toPromise()

  expect(res).toEqual([2, 3, 4])
})
