importScripts('./exstream.iife.min.js')

const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(message)
}

const run = async () => {
  equal(
    await Exstream([1, 2, 3])
      .map((value) => value * 2)
      .toArray(),
    [2, 4, 6],
    'worker core',
  )

  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(3)
      controller.close()
    },
  })
  equal(await Exstream(readable).toArray(), [3], 'worker Web Stream')

  let deferredInvocations = 0
  const deferred = Exstream.defer(() => {
    deferredInvocations += 1
    return [4]
  })
  if (deferredInvocations !== 0) throw Error('worker deferred source started eagerly')
  equal(await deferred.toArray(), [4], 'worker deferred source')
  if (deferredInvocations !== 1) throw Error('worker deferred source started more than once')

  const csv = new TextEncoder().encode('a,b\n1,2\n')
  equal(await Exstream([csv]).csv({ header: true }).toArray(), [{ a: '1', b: '2' }], 'worker CSV')

  const json = new TextEncoder().encode('{"rows":[1,2,3]}')
  equal(await Exstream([json]).json({ path: '$.rows[*]' }).toArray(), [1, 2, 3], 'worker JSON')

  const jsonl = new TextEncoder().encode('{"id":1}\n{"id":2}\n')
  equal(await Exstream([jsonl]).jsonl().toArray(), [{ id: 1 }, { id: 2 }], 'worker JSONL')

  postMessage({ checks: 6, ok: true })
}

run().catch((error) => postMessage({ error: error.stack || String(error), ok: false }))