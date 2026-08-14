const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const core = require('exstream.js/core')
const web = require('exstream.js/web')

const run = async () => {
  const source = web([1])
  assert.equal(core, web)
  assert.equal(source instanceof EventEmitter, false)
  assert.equal(source.emit('unobserved'), false)
  assert.throws(
    () => source.emit('error', Error('unobserved browser error')),
    /unobserved browser error/,
  )
  source.on('first', () => {}).on('second', () => {})
  source.removeAllListeners()
  assert.deepEqual(source.eventNames(), [])

  const contextual = await web([1, 2, 3])
    .withContext((value) => ({ correlationId: `row-${value}` }))
    .mapAsync(async (value, context) => ({
      correlationId: context.correlationId,
      value: value * 10,
    }))
    .toPromise()
  assert.deepEqual(contextual, [
    { correlationId: 'row-1', value: 10 },
    { correlationId: 'row-2', value: 20 },
    { correlationId: 'row-3', value: 30 },
  ])

  const iterable = {
    async *[Symbol.asyncIterator]() {
      yield 1
      yield 2
    },
  }
  assert.deepEqual(await web(iterable).toPromise(), [1, 2])

  const decoded = await web(['AQ', 'IDBA==']).decode('base64').toPromise()
  assert.deepEqual(decoded, [new Uint8Array([1, 2, 3, 4])])
  assert.equal(Buffer.isBuffer(decoded[0]), false)

  const encoder = new TextEncoder()
  const bytes = encoder.encode('a💥b\n1💥2\n')
  const chunks = [bytes.slice(0, 2), bytes.slice(2, 5), bytes.slice(5)]
  assert.deepEqual(await web(chunks).csv({ header: true, separator: '💥' }).toPromise(), [
    { a: '1', b: '2' },
  ])

  const json = encoder.encode('{"rows":[{"id":1},{"id":2}]}')
  assert.deepEqual(await web([json]).json({ path: '$.rows[*]' }).toPromise(), [
    { id: 1 },
    { id: 2 },
  ])
  assert.deepEqual(await web(['1\n2\n']).through(web.jsonl()).toPromise(), [1, 2])

  assert.throws(() => web([1]).toNodeStream(), /toNodeStream\(\) is not available in this runtime/)

  process.stdout.write('EXSTREAM_BROWSER_ENTRY_PASS checks=9')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})