const _ = require('../src/index')

test('sortedLeftJoin', async () => {
  const s1 = _([{id: 1, name: 'parent1'}, {id: 2, name: 'parent2'}, {id: 3, name: 'parent3'}])
  const s2 = _([
    {id: 'child1', parent: 1},
    {id: 'child2', parent: 1},
    {id: 'child3',parent: 3},
    {id: 'child4',parent: 4},
  ])
  const res = await _([s1,s2]).sortedJoin((a,b) => a.id === b.parent, 'left').values()
  expect(res).toEqual([
    {
      a: {id: 1, name: 'parent1'},
      b: {id: 'child1', parent: 1},
    },
    {
      a: {id: 1, name: 'parent1'},
      b: {id: 'child2', parent: 1},
    },
    {
      a: {id: 2, name: 'parent2'},
      b: null,
    },
    {
      a: {id: 3, name: 'parent3'},
      b: {id: 'child3', parent: 3},
    },
  ])
})

test('multiple hits on second parent', async () => {
  const s1 = _([{id: 1, name: 'parent1'}, {id: 2, name: 'parent2'}, {id: 3, name: 'parent3'}])
  const s2 = _([
    {id: 'child1', parent: 2},
    {id: 'child2', parent: 2},
    {id: 'child3',parent: 3},
    {id: 'child4',parent: 4},
  ])
  const res = await _([s1,s2]).sortedJoin((a,b) => a.id === b.parent, 'inner').values()
  expect(res).toEqual([
    {
      a: {id: 2, name: 'parent2'},
      b: {id: 'child1', parent: 2},
    },
    {
      a: {id: 2, name: 'parent2'},
      b: {id: 'child2', parent: 2},
    },
    {
      a: {id: 3, name: 'parent3'},
      b: {id: 'child3', parent: 3},
    },
  ])
})

test('sortedRightJoin', async () => {
  const s1 = _([
    {id: 'child1', parent: 1},
    {id: 'child2', parent: 1},
    {id: 'child3',parent: 3},
    {id: 'child4',parent: 4},
  ])
  const s2 = _([{id: 1, name: 'parent1'}, {id: 2, name: 'parent2'}, {id: 3, name: 'parent3'}])
  const res = await _([s1,s2]).sortedJoin((a,b) => a.parent === b.id, 'right').values()
  expect(res).toEqual([
    {
      a: {id: 1, name: 'parent1'},
      b: {id: 'child1', parent: 1},
    },
    {
      a: {id: 1, name: 'parent1'},
      b: {id: 'child2', parent: 1},
    },
    {
      a: {id: 2, name: 'parent2'},
      b: null,
    },
    {
      a: {id: 3, name: 'parent3'},
      b: {id: 'child3', parent: 3},
    },
  ])
})

test('sortedInnerJoin', async () => {
  const s1 = _([{id: 1, name: 'parent1'}, {id: 2, name: 'parent2'}, {id: 3, name: 'parent3'}])
  const s2 = _([
    {id: 'child1', parent: 1},
    {id: 'child2', parent: 1},
    {id: 'child3',parent: 3},
    {id: 'child4',parent: 4},
  ])
  const res = await _([s1,s2]).sortedJoin((a,b) => a.id === b.parent).values()
  expect(res).toEqual([
    {
      a: {id: 1, name: 'parent1'},
      b: {id: 'child1', parent: 1},
    },
    {
      a: {id: 1, name: 'parent1'},
      b: {id: 'child2', parent: 1},
    },
    {
      a: {id: 3, name: 'parent3'},
      b: {id: 'child3', parent: 3},
    },
  ])
})

test('sortedLeftJoinWithErrors', async () => {
  let exc = null
  const s1 = _([{id: 1, name: 'parent1'}, {id: 2, name: 'parent2'}, {id: 3, name: 'parent3'}])
  const s2 = _([
    {id: 'child1', parent: 1},
    {id: 'child2', parent: 1},
    {id: 'child3',parent: 2},
    {id: 'child4',parent: 3},
  ])
  const res = await _([s1,s2]).sortedJoin((a,b) => {
    if(a.id === 2) throw Error('an error')
    return a.id === b.parent
  }, 'left', 100)
    .errors(e => {
      exc = e
    })
    .values()
  expect(exc).not.toBe(null)
  expect(res).toEqual([
    {
      a: {id: 1, name: 'parent1'},
      b: {id: 'child1', parent: 1},
    },
    {
      a: {id: 1, name: 'parent1'},
      b: {id: 'child2', parent: 1},
    },
  ])
})
