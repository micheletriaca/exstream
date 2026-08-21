const _ = require('../src/index.js')

test('JSONL syntax errors remain record-scoped when the next line is safe to parse', async () => {
  const errors = []

  const values = await _(['{"id":1}\ninvalid\n{"id":2}\n'])
    .jsonl()
    .errors((error) => errors.push(error))
    .toArray()

  expect(values).toEqual([{ id: 1 }, { id: 2 }])
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({ name: 'JsonParseError', record: 2 })
  expect(_.errorInfo(errors[0])).toMatchObject({ origin: 'format', stage: 'jsonl' })
})

test('JSONL stringify errors remain record-scoped because no partial line was emitted', async () => {
  const errors = []

  const values = await _([1, void 0, 2])
    .jsonlStringify()
    .errors((error) => errors.push(error))
    .toArray()

  expect(values).toEqual(['1\n', '2\n'])
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({ name: 'JsonStringifyError', record: 2 })
  expect(_.errorInfo(errors[0])).toMatchObject({
    origin: 'format',
    stage: 'jsonlStringify',
  })
})

test('a JSONL size violation terminates the branch even when record errors are handled', async () => {
  const errors = []
  const result = _(['12345\n1\n'])
    .jsonl({ maxRecordBytes: 4 })
    .errors((error) => errors.push(error))
    .toArray()

  await expect(result).rejects.toMatchObject({ code: 'EXSTREAM_JSONL_MAX_RECORD_BYTES' })
  expect(errors).toHaveLength(1)
})

test.each([
  ['JSON document', () => _(['{"missing":']).json()],
  ['CSV parser', () => _(['"unterminated']).csv()],
])('%s structural errors terminate their branch after reaching handlers', async (label, create) => {
  const errors = []
  const result = create()
    .errors((error) => errors.push(error))
    .toArray()

  const failure = await result.catch((error) => error)
  expect(failure).toBe(errors[0])
  expect(errors).toHaveLength(1)
  expect(_.errorInfo(errors[0])).toMatchObject({ origin: 'format' })
})

test('JSON document stringify failures cannot be handled into a successful partial document', async () => {
  const cyclic = {}
  cyclic.self = cyclic
  const errors = []
  const result = _([1, cyclic])
    .jsonStringify()
    .errors((error) => errors.push(error))
    .toArray()

  const failure = await result.catch((error) => error)
  expect(failure).toBe(errors[0])
  expect(errors).toHaveLength(1)
  expect(_.errorInfo(errors[0])).toMatchObject({ origin: 'format', stage: 'jsonStringify' })
})

test('errorInfo infers format errors and safely describes unknown reasons', () => {
  const csvError = new _.CsvStringifyError('invalid output', { record: 1 })

  expect(_.errorInfo(csvError)).toMatchObject({ origin: 'format', stage: 'csvStringify' })
  expect(_.errorInfo(Error('plain failure'))).toEqual({ origin: 'unknown' })
  expect(_.errorInfo('non-error rejection')).toEqual({ origin: 'unknown' })
})