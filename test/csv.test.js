const _ = require('../src/index')
// const csv = require('csv')

test('csv', () => {
  _([Buffer.from('a,b,c\n1,2,3\n"ciao ""amico""","multiline\nrow",3\n')])
    .csv({ header: true })
    .toArray(res => {
      expect(res).toEqual([
        { a: '1', b: '2', c: '3' },
        { a: 'ciao "amico"', b: 'multiline\nrow', c: '3' },
      ])
    })

  _([Buffer.from('a,b,c\n1,2,3\n"ciao "'), Buffer.from('"amico""","multiline\nrow",3\n')])
    .csv({ header: ['aa', 'bb', 'cc'] })
    .toArray(res => {
      expect(res).toEqual([
        { aa: 'a', bb: 'b', cc: 'c' },
        { aa: '1', bb: '2', cc: '3' },
        { aa: 'ciao "amico"', bb: 'multiline\nrow', cc: '3' },
      ])
    })

  _([Buffer.from('a,b,c\n1,2,3\n"ciao ""amico""","multiline\nrow",3\n')])
    .csv({ header: row => row.map(x => x + x) })
    .toArray(res => {
      expect(res).toEqual([
        { aa: '1', bb: '2', cc: '3' },
        { aa: 'ciao "amico"', bb: 'multiline\nrow', cc: '3' },
      ])
    })

  _([Buffer.from('a,b,c\r\n1,2,3\r\n"ciao ""amico""","multi,li""n""e\nrow","3""bis"""\n')])
    .csv({ header: false })
    .toArray(res => {
      expect(res).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
        ['ciao "amico"', 'multi,li"n"e\nrow', '3"bis"'],
      ])
    })
})

test('csvStringify', () => {
  let res = _([Buffer.from('a,b,,c\n1,2,,3\n"ciao ""amico""","multiline\nrow",3,4\n')])
    .csv({ header: true })
    .csvStringify({ header: true })
    .values()

  expect(res.join('')).toEqual('a,b,,c\n1,2,,3\n"ciao ""amico""","multiline\nrow",3,4\n')

  res = _([Buffer.from('a,b,c\n1,2,3\n"ciao "'), Buffer.from('"amico""","multiline\nrow",3\n')])
    .csv({ header: ['aa', 'bb', 'cc'] })
    .csvStringify({ header: true, quoted: true })
    .values()

  expect(res.join('')).toEqual('"aa","bb","cc"\n"a","b","c"\n"1","2","3"\n"ciao ""amico""","multiline\nrow","3"\n')

  res = _([Buffer.from('a,b,c\n1,2,3\n"ciao "'), Buffer.from('"amico""","multiline\nrow",3')])
    .csv({ header: ['aa', 'bb', 'cc'] })
    .csvStringify({ header: false })
    .values()

  expect(res.join('')).toEqual('a,b,c\n1,2,3\n"ciao ""amico""","multiline\nrow",3\n')

  res = _([Buffer.from('a,b,c,d\n1,2,3,\n"ciao "'), Buffer.from('"amico""","multiline\nrow",3,')])
    .csv()
    .csvStringify({ header: false, quotedEmpty: true })
    .values()

  expect(res.join('')).toEqual('a,b,c,d\n1,2,3,""\n"ciao ""amico""","multiline\nrow",3,""\n')

  res = _([Buffer.from('a,b,c,d\n"escaped \\" quote ",2,3,4')])
    .csv({ escape: '\\' })
    .csvStringify({ header: false, quotedEmpty: true, escape: '\\', finalNewline: false })
    .values()

  expect(res.join('')).toEqual('a,b,c,d\n"escaped \\" quote ",2,3,4\n')

  res = _([Buffer.from('a,b,c,d\naa,bb,cc,dd\n')])
    .csv({ header: true })
    .csvStringify({ header: true, encoding: 'utf16le' })
    .values()

  expect(res[0]).toEqual(Buffer.from('a,b,c,d\n', 'utf16le'))
  expect(res[1]).toEqual(Buffer.from('aa,bb,cc,dd\n', 'utf16le'))
})

test('csv fast mode', () => {
  let res = _([Buffer.from('a,b,c\n1,2,3\n4,5'), Buffer.from(',6\nu,v,z')])
    .csv({ header: true, fastMode: true })
    .values()

  expect(res).toEqual([
    { a: '1', b: '2', c: '3' },
    { a: '4', b: '5', c: '6' },
    { a: 'u', b: 'v', c: 'z' },
  ])

  res = _([Buffer.from('a,b,c\n1,2,3\n4,5'), Buffer.from(',6\nu,v,z')])
    .csv({ fastMode: true })
    .values()

  expect(res).toEqual([
    ['a', 'b', 'c'],
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['u', 'v', 'z'],
  ])
})

test('csv stringify - non string values', () => {
  const res = _([[1, false, true], [null, 5, 6]])
    .csvStringify()
    .values()
    .join('')
  expect(res).toEqual('1,false,true\nnull,5,6\n')
})

/*
TODO -> FIX ERROR HANDLING AND WRITE TESTS ABOUT IT
*/
