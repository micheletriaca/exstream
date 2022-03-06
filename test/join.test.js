/* eslint-disable max-lines-per-function */
/* eslint-disable max-lines */
/* eslint-disable max-statements-per-line */
/* eslint-disable max-len */
const _ = require('../src/index')
const { sleep } = require('./helpers')

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
    { id: 'child3',parent: 3 },
    { id: 'child4',parent: 4 },
  ])

  const res = await _([s1,s2]).sortedJoin(a => a.id, b => b.parent, 'left').values()
  expect(res).toEqual([
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child2', parent: 1 },
    },
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: null,
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child3', parent: 3 },
    },
    {
      key: 10,
      a: { id: 10, name: 'parent10' },
      b: null,
    },
    {
      key: 11,
      a: { id: 11, name: 'parent11' },
      b: null,
    },
  ])
})

test('sortedJoin - left - with join strings', async () => {
  const s1 = _([{ id: 1, name: 'parent1' }, { id: 2, name: 'parent2' }, { id: 3, name: 'parent3' }])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3',parent: 3 },
    { id: 'child4',parent: 4 },
  ])
  const res = await _([s1,s2]).sortedJoin('id', 'parent', 'left').values()
  expect(res).toEqual([
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child2', parent: 1 },
    },
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: null,
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child3', parent: 3 },
    },
  ])
})

test('sortedJoin - no more than 2 substreams', async () => {
  let exc
  await _([_(), _(), _()])
    .sortedJoin('id', 'id', 'left', 'asc')
    .values()
    .catch(e => void (exc = e))

  expect(exc).not.toBe(null)
  expect(exc.message).toBe('.sortedJoin() can merge only 2 exstream instances')
})

test('sortedJoin - sync error in source stream generation', async () => {
  let exc

  const s3 = _([1, 2])
    .map(x => {
      if(x === 2) throw Error('an error')
      return _([x])
    })
    .sortedJoin('id', 'id', 'left', 'asc')

  await sleep(0)
  await s3.values()
    .catch(e => void (exc = e))

  expect(exc).not.toBe(null)
  expect(exc.message).toBe('an error')
})

test('sortedJoin - inner - complex', async () => {
  const s1 = _([{ id: 1, name: 'parent1' }, { id: 1, name: 'parent2' }, { id: 4, name: 'parent4' }])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child3',parent: 2 },
    { id: 'child3',parent: 3 },
    { id: 'child4',parent: 4 },
    { id: 'child5',parent: 5 },
  ])
  const res = await _([s1,s2]).sortedJoin(
    a => a.id,
    b => b.parent,
    'inner',
    'asc',
  ).values()
  expect(res).toEqual([
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      a: { id: 1, name: 'parent2' },
      b: { id: 'child1', parent: 1 },
    },
    {
      key: 4,
      a: { id: 4, name: 'parent4' },
      b: { id: 'child4',parent: 4 },
    },
  ])
})

test('multiple hits on second parent', async () => {
  const s1 = _([{ id: 1, name: 'parent1' }, { id: 2, name: 'parent2' }, { id: 3, name: 'parent3' }])
  const s2 = _([
    { id: 'child1', parent: 2 },
    { id: 'child2', parent: 2 },
    { id: 'child3',parent: 3 },
    { id: 'child4',parent: 4 },
  ])
  const res = await _([s1,s2]).sortedJoin(a => a.id, b => b.parent, 'inner').values()
  expect(res).toEqual([
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: { id: 'child1', parent: 2 },
    },
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: { id: 'child2', parent: 2 },
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child3', parent: 3 },
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
  const res = await _([s1,s2]).sortedJoin(a => a.parent, b => b.parent, 'inner').values()
  expect(res).toEqual([
    {
      key: 1,
      a: { t: 'childOfAnObject', parent: 1 },
      b: { t: 'childOfAnObject2', parent: 1 },
    },
    {
      key: 1,
      a: { t: 'anotherChildOfAnObject', parent: 1 },
      b: { t: 'childOfAnObject2', parent: 1 },
    },
    {
      key: 1,
      a: { t: 'childOfAnObject', parent: 1 },
      b: { t: 'anotherChildOfAnObject2', parent: 1 },
    },
    {
      key: 1,
      a: { t: 'anotherChildOfAnObject', parent: 1 },
      b: { t: 'anotherChildOfAnObject2', parent: 1 },
    },
  ])
})

test('join with async source', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ]).map(async x => {
    await sleep(0)
    return x
  })
    .resolve()
  const s2 = _([
    { id: 'child1', parent: 2 },
    { id: 'child2', parent: 2 },
    { id: 'child3',parent: 3 },
    { id: 'child4',parent: 4 },
  ])
  const res = await _([s1,s2]).sortedJoin(a => a.id, b => b.parent, 'inner').values()
  expect(res).toEqual([
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: { id: 'child1', parent: 2 },
    },
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: { id: 'child2', parent: 2 },
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child3', parent: 3 },
    },
  ])
})

test('join that starts later', async () => {
  const s1 = _([
    { id: 1, name: 'parent1' },
    { id: 2, name: 'parent2' },
    { id: 3, name: 'parent3' },
  ]).map(async x => {
    await sleep(0)
    return x
  })
    .resolve()
  const s2 = _([
    { id: 'child1', parent: 2 },
    { id: 'child2', parent: 2 },
    { id: 'child3',parent: 3 },
    { id: 'child4',parent: 4 },
  ])
  const s3 = _([s1,s2]).sortedJoin(a => a.id, b => b.parent, 'inner')
  await sleep(0)
  const res = await s3.values()
  expect(res).toEqual([
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: { id: 'child1', parent: 2 },
    },
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: { id: 'child2', parent: 2 },
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child3', parent: 3 },
    },
  ])
})

test('sortedJoin - right', async () => {
  const s1 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3',parent: 3 },
    { id: 'child4',parent: 4 },
  ])
  const s2 = _([{ id: 1, name: 'parent1' }, { id: 2, name: 'parent2' }, { id: 3, name: 'parent3' }])
  const res = await _([s1,s2]).sortedJoin(a => a.parent, b => b.id, 'right').values()
  expect(res).toEqual([
    {
      key: 1,
      a: { id: 'child1', parent: 1 },
      b: { id: 1, name: 'parent1' },
    },
    {
      key: 1,
      a: { id: 'child2', parent: 1 },
      b: { id: 1, name: 'parent1' },
    },
    {
      key: 2,
      a: null,
      b: { id: 2, name: 'parent2' },
    },
    {
      key: 3,
      a: { id: 'child3', parent: 3 },
      b: { id: 3, name: 'parent3' },
    },
  ])
})

test('sortedInnerJoin', async () => {
  const s1 = _([{ id: 1, name: 'parent1' }, { id: 2, name: 'parent2' }, { id: 3, name: 'parent3' }])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3',parent: 3 },
    { id: 'child4',parent: 4 },
  ])
  const res = await _([s1,s2]).sortedJoin(a => a.id, b => b.parent).values()
  expect(res).toEqual([
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child2', parent: 1 },
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child3', parent: 3 },
    },
  ])
})

test('sortedLeftJoinWithErrors', async () => {
  let exc = null
  const s1 = _([{ id: 1, name: 'parent1' }, { id: 2, name: 'parent2' }, { id: 3, name: 'parent3' }])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3',parent: 2 },
    { id: 'child4',parent: 3 },
  ])
  const res = await _([s1,s2]).sortedJoin(a => {
    if(a.id === 2) throw Error('an error')
    return a.id
  }, b => b.parent, 'left', 'asc', 100)
    .errors(e => {
      exc = e
    })
    .values()
  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child1', parent: 1 },
    },
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child2', parent: 1 },
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child4', parent: 3 },
    },
  ])
})

test('sortedLeftJoinWithErrorsInB', async () => {
  let exc = null
  const s1 = _([{ id: 1, name: 'parent1' }, { id: 2, name: 'parent2' }, { id: 3, name: 'parent3' }])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3',parent: 2 },
    { id: 'child4',parent: 3 },
  ])
  const res = await _([s1,s2]).sortedJoin(a => a.id, b => {
    if(b.id === 'child2') throw Error('an error')
    return b.parent
  }, 'left', 'asc', 100)
    .errors(e => {
      exc = e
    })
    .values()
  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child1', parent: 1 },
    },
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: { id: 'child3', parent: 2 },
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child4', parent: 3 },
    },
  ])
})

test('sortedLeftJoin - WithErrors In substream B', async () => {
  let exc = null
  const s1 = _([{ id: 1, name: 'parent1' }, { id: 2, name: 'parent2' }, { id: 3, name: 'parent3' }])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3',parent: 2 },
    { id: 'child4',parent: 3 },
  ]).map(x => {
    if(x.id === 'child2') throw Error('an error')
    return x
  })

  const res = await _([s1,s2]).sortedJoin(a => a.id, b => b.parent, 'left', 'asc', 100)
    .errors(e => {
      exc = e
    })
    .values()
  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 1,
      a: { id: 1, name: 'parent1' },
      b: { id: 'child1', parent: 1 },
    },
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: { id: 'child3', parent: 2 },
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child4', parent: 3 },
    },
  ])
})

test('sortedRightJoinWithErrors', async () => {
  let exc = null
  const s1 = _([{ id: 1, name: 'parent1' }, { id: 2, name: 'parent2' }, { id: 3, name: 'parent3' }])
  const s2 = _([
    { id: 'child1', parent: 1 },
    { id: 'child2', parent: 1 },
    { id: 'child3',parent: 2 },
    { id: 'child4',parent: 3 },
  ])
  const res = await _([s1,s2]).sortedJoin(a => a.id, b => {
    if(b.parent === 1) throw Error('an error')
    return b.parent
  }, 'right', 'asc', 100)
    .errors(e => {
      exc = e
    })
    .values()
  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 2,
      a: { id: 2, name: 'parent2' },
      b: { id: 'child3', parent: 2 },
    },
    {
      key: 3,
      a: { id: 3, name: 'parent3' },
      b: { id: 'child4', parent: 3 },
    },
  ])
})

test('sorted group by', () => {
  const res = _([{ id: 1, name: 'name1' }, { id: 1, name: 'name2' }, { id: 2, name: 'name3' }, { name: 'name4' }])
    .sortedGroupBy(x => x.id)
    .values()

  expect(res).toEqual([
    {
      key: 1,
      values: [{ id: 1, name: 'name1' }, { id: 1, name: 'name2' }],
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

test('sorted group by - string', () => {
  const res = _([{ id: 1, name: 'name1' }, { id: 1, name: 'name2' }, { id: 2, name: 'name3' }, { name: 'name4' }])
    .sortedGroupBy('id')
    .values()

  expect(res).toEqual([
    {
      key: 1,
      values: [{ id: 1, name: 'name1' }, { id: 1, name: 'name2' }],
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

test('sorted group by. empty stream does not emit anything', () => {
  const res = _([])
    .sortedGroupBy(x => x.id)
    .values()

  expect(res).toEqual([])
})

test('sorted group by. error in key fn', () => {
  let exc
  const res = _([{ id: 1, name: 'name1' }, { id: 1, name: 'name2' }, { id: 2, name: 'name3' }, { name: 'name4' }])
    .sortedGroupBy(x => { if(x.id === 2) throw Error('an error'); return x.id })
    .errors(e => {exc = e})
    .values()

  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      key: 1,
      values: [{ id: 1, name: 'name1' }, { id: 1, name: 'name2' }],
    },
    {
      key: undefined,
      values: [{ name: 'name4' }],
    },
  ])
})
