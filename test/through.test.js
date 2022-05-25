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

test('through accepts null', () => {
  const s = _([1, 2, 3])
  const s1 = s.through(null)
  expect(s).toBe(s1)
})

test('through does not accept undefined', () => {
  const s = _([1, 2, 3])
  const s1 = s.through(undefined)
  expect(s).toBe(s1)
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
