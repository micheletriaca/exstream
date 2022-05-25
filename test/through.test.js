const _ = require('../src/index.js')

test('through pipeline', () => {
  _([1, 2, 3])
    .through(_.pipeline()
      .map(x => x * 2)
      .map(x => x * 2),
    )
    .toArray(res => {
      expect(res).toEqual([4, 8, 12])
    })
})

test('through does not accept null', async () => {
  const s = _([])
  expect(s.through(null)).toThrow()
})

test('through does not accept undefined', async () => {
  const s = _([])
  expect(s.through(undefined)).toThrow()
})

test('through _.function', async () => {
  const transform = _.map(x => x.toString(), null)

  const res = await _([1, 2, 3])
    .through(transform)
    .toPromise()

  expect(res).toEqual(['1', '2', '3'])
})

test('through stream', () => {
  _([1, 2, 3])
    .through(_()
      .map(x => x * 2)
      .map(x => x * 2),
    )
    .toArray(res => {
      expect(res).toEqual([4, 8, 12])
    })

  let exception = false
  try {
    _([1, 2, 3]).through(2)
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
})
