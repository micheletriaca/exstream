const _ = require('../src/index')
const { sleep } = require('./helpers')

test('sortedJoin - left - left stream empty', async () => {
  const s1 = _([])
  const s2 = _([{ id: 1 }, { id: 2 }])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.id,
      type: 'left',
    })
    .toArray()
  expect(res).toEqual([])
})

test('sortedJoin - right - left stream empty', async () => {
  const s1 = _([])
  const s2 = _([{ id: 1 }, { id: 2 }])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.id,
      type: 'right',
    })
    .toArray()
  expect(res).toEqual([
    {
      key: 1,
      left: null,
      right: { id: 1 },
    },
    {
      key: 2,
      left: null,
      right: { id: 2 },
    },
  ])
})

test('sortedJoin - left - right stream empty', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
  ])
  const s2 = _([])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.parent,
      type: 'left',
    })
    .toArray()
  expect(res).toEqual([
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: null,
    },
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: null,
    },
  ])
})

test('sortedJoin - right - right stream empty', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
  ])
  const s2 = _([])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.parent,
      type: 'right',
    })
    .toArray()
  expect(res).toEqual([])
})

test('sortedJoin - left', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
    { id: 10, name: 'parent10' },
    { id: 11, name: 'parent11' },
  ])

  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3', parent: 3 },
    { id: 'child4', parent: 4 },
  ])

  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.parent,
      type: 'left',
    })
    .toArray()
  expect(res).toEqual([
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child2', parent: 1 },
    },
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: null,
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child3', parent: 3 },
    },
    {
      key: 10,
      left: { id: 10, name: 'parent10' },
      right: null,
    },
    {
      key: 11,
      left: { id: 11, name: 'parent11' },
      right: null,
    },
  ])
})

test('sortedJoin - left - with join strings', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3', parent: 3 },
    { id: 'child4', parent: 4 },
  ])
  const res = await s1.sortedJoin(s2, { leftKey: 'id', rightKey: 'parent', type: 'left' }).toArray()
  expect(res).toEqual([
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child2', parent: 1 },
    },
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: null,
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child3', parent: 3 },
    },
  ])
})

test('sortedJoin requires a distinct Exstream as its right input', () => {
  const left = _([])
  const options = { leftKey: 'id', rightKey: 'id' }

  expect(() => left.sortedJoin([], options)).toThrow(
    'error in .sortedJoin(). right must be an Exstream',
  )
  expect(() => left.sortedJoin(left, options)).toThrow(
    'error in .sortedJoin(). left and right must be different Exstream instances',
  )
})

test('sortedJoin - inner - complex', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 1, name: 'parent2' },
    { id: 4, name: 'parent4' },
  ])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child3', parent: 2 },
    { id: 'child3', parent: 3 },
    { id: 'child4', parent: 4 },
    { id: 'child5', parent: 5 },
  ])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.parent,
    })
    .toArray()
  expect(res).toEqual([
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      left: { id: 1, name: 'parent2' },
      right: { id: 'child1', parent: 1 },
    },
    {
      key: 4,
      left: { id: 4, name: 'parent4' },
      right: { id: 'child4', parent: 4 },
    },
  ])
})

test('multiple hits on second parent', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
  const s2 = _([
    { id: 'child1', parent: 2 },
    { id: 'child2', parent: 2 },
    { id: 'child3', parent: 3 },
    { id: 'child4', parent: 4 },
  ])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.parent,
    })
    .toArray()
  expect(res).toEqual([
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: { id: 'child1', parent: 2 },
    },
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: { id: 'child2', parent: 2 },
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child3', parent: 3 },
    },
  ])
})

test('multiple keys in both s1 and s2', async () => {
  const s1 = _([
    { t: 'childOfAnObject', parent: 1 },
    { t: 'anotherChildOfAnObject', parent: 1 },
    { t: 'x', parent: 2 },
  ])
  const s2 = _([
    { t: 'childOfAnObject2', parent: 1 },
    { t: 'anotherChildOfAnObject2', parent: 1 },
  ])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.parent,
      rightKey: (b) => b.parent,
    })
    .toArray()
  expect(res).toEqual([
    {
      key: 1,
      left: { t: 'childOfAnObject', parent: 1 },
      right: { t: 'childOfAnObject2', parent: 1 },
    },
    {
      key: 1,
      left: { t: 'anotherChildOfAnObject', parent: 1 },
      right: { t: 'childOfAnObject2', parent: 1 },
    },
    {
      key: 1,
      left: { t: 'childOfAnObject', parent: 1 },
      right: { t: 'anotherChildOfAnObject2', parent: 1 },
    },
    {
      key: 1,
      left: { t: 'anotherChildOfAnObject', parent: 1 },
      right: { t: 'anotherChildOfAnObject2', parent: 1 },
    },
  ])
})

test('join with async source', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
    .map(async (x) => {
      await sleep(0)
      return x
    })
    .mapAsync((value) => value)
  const s2 = _([
    { id: 'child1', parent: 2 },
    { id: 'child2', parent: 2 },
    { id: 'child3', parent: 3 },
    { id: 'child4', parent: 4 },
  ])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.parent,
    })
    .toArray()
  expect(res).toEqual([
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: { id: 'child1', parent: 2 },
    },
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: { id: 'child2', parent: 2 },
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child3', parent: 3 },
    },
  ])
})

test('join that starts later', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
    .map(async (x) => {
      await sleep(0)
      return x
    })
    .mapAsync((value) => value)
  const s2 = _([
    { id: 'child1', parent: 2 },
    { id: 'child2', parent: 2 },
    { id: 'child3', parent: 3 },
    { id: 'child4', parent: 4 },
  ])
  const s3 = s1.sortedJoin(s2, {
    leftKey: (a) => a.id,
    rightKey: (b) => b.parent,
  })
  await sleep(0)
  const res = await s3.toArray()
  expect(res).toEqual([
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: { id: 'child1', parent: 2 },
    },
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: { id: 'child2', parent: 2 },
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child3', parent: 3 },
    },
  ])
})

test('sortedJoin - right', async () => {
  const s1 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3', parent: 3 },
    { id: 'child4', parent: 4 },
  ])
  const s2 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.parent,
      rightKey: (b) => b.id,
      type: 'right',
    })
    .toArray()
  expect(res).toEqual([
    {
      key: 1,
      left: { id: 'child1', parent: 1 },
      right: { id: 1, name: 'parent1' },
    },
    {
      key: 1,
      left: { id: 'child2', parent: 1 },
      right: { id: 1, name: 'parent1' },
    },
    {
      key: 2,
      left: null,
      right: { id: 2, name: 'parent2' },
    },
    {
      key: 3,
      left: { id: 'child3', parent: 3 },
      right: { id: 3, name: 'parent3' },
    },
  ])
})

test('sortedInnerJoin', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3', parent: 3 },
    { id: 'child4', parent: 4 },
  ])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.parent,
    })
    .toArray()
  expect(res).toEqual([
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child2', parent: 1 },
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child3', parent: 3 },
    },
  ])
})

test('sortedLeftJoinWithErrors', async () => {
  let exc = null
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3', parent: 2 },
    { id: 'child4', parent: 3 },
  ])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => {
        if (a.id === 2) throw Error('an error')
        return a.id
      },
      rightKey: (b) => b.parent,
      type: 'left',
    })
    .errors((e) => {
      exc = e
    })
    .toArray()
  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child2', parent: 1 },
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child4', parent: 3 },
    },
  ])
})

test('sortedLeftJoinWithErrorsInB', async () => {
  let exc = null
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3', parent: 2 },
    { id: 'child4', parent: 3 },
  ])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => {
        if (b.id === 'child2') throw Error('an error')
        return b.parent
      },
      type: 'left',
    })
    .errors((e) => {
      exc = e
    })
    .toArray()
  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child1', parent: 1 },
    },
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: { id: 'child3', parent: 2 },
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child4', parent: 3 },
    },
  ])
})

test('sortedLeftJoin - WithErrors In substream B', async () => {
  let exc = null
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3', parent: 2 },
    { id: 'child4', parent: 3 },
  ]).map((x) => {
    if (x.id === 'child2') throw Error('an error')
    return x
  })

  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => b.parent,
      type: 'left',
    })
    .errors((e) => {
      exc = e
    })
    .toArray()
  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 1,
      left: { id: 1, name: 'parent1' },
      right: { id: 'child1', parent: 1 },
    },
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: { id: 'child3', parent: 2 },
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child4', parent: 3 },
    },
  ])
})

test('sortedRightJoinWithErrors', async () => {
  let exc = null
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3', parent: 2 },
    { id: 'child4', parent: 3 },
  ])
  const res = await s1
    .sortedJoin(s2, {
      leftKey: (a) => a.id,
      rightKey: (b) => {
        if (b.parent === 1) throw Error('an error')
        return b.parent
      },
      type: 'right',
    })
    .errors((e) => {
      exc = e
    })
    .toArray()
  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 2,
      left: { id: 2, name: 'parent2' },
      right: { id: 'child3', parent: 2 },
    },
    {
      key: 3,
      left: { id: 3, name: 'parent3' },
      right: { id: 'child4', parent: 3 },
    },
  ])
})

test('sorted group by', async () => {
  const res = await _([
    { id: 1, name: 'name1' },
    { id: 1, name: 'name2' },
    { id: 2, name: 'name3' },
    { name: 'name4' },
  ])
    .sortedGroupBy((x) => x.id)
    .toArray()

  expect(res).toEqual([
    {
      key: 1,
      values: [
        { id: 1, name: 'name1' },
        { id: 1, name: 'name2' },
      ],
    },
    {
      key: 2,
      values: [{ id: 2, name: 'name3' }],
    },
    {
      key: undefined,
      values: [{ name: 'name4' }],
    },
  ])
})

test('sorted group by - string', async () => {
  const res = await _([
    { id: 1, name: 'name1' },
    { id: 1, name: 'name2' },
    { id: 2, name: 'name3' },
    { name: 'name4' },
  ])
    .sortedGroupBy('id')
    .toArray()

  expect(res).toEqual([
    {
      key: 1,
      values: [
        { id: 1, name: 'name1' },
        { id: 1, name: 'name2' },
      ],
    },
    {
      key: 2,
      values: [{ id: 2, name: 'name3' }],
    },
    {
      key: undefined,
      values: [{ name: 'name4' }],
    },
  ])
})

test('sorted group by. empty stream does not emit anything', async () => {
  const res = await _([])
    .sortedGroupBy((x) => x.id)
    .toArray()

  expect(res).toEqual([])
})

test('sorted group by. error in key fn', async () => {
  let exc
  const res = await _([
    { id: 1, name: 'name1' },
    { id: 1, name: 'name2' },
    { id: 2, name: 'name3' },
    { name: 'name4' },
  ])
    .sortedGroupBy((x) => {
      if (x.id === 2) throw Error('an error')
      return x.id
    })
    .errors((e) => {
      exc = e
    })
    .toArray()

  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 1,
      values: [
        { id: 1, name: 'name1' },
        { id: 1, name: 'name2' },
      ],
    },
    {
      key: undefined,
      values: [{ name: 'name4' }],
    },
  ])
})