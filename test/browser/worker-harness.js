importScripts('./exstream.iife.js')

const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(message)
}

const run = async () => {
  equal(
    await Exstream([1, 2, 3])
      .map((value) => value * 2)
      .toPromise(),
    [2, 4, 6],
    'worker core',
  )

  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(3)
      controller.close()
    },
  })
  equal(await Exstream(readable).toPromise(), [3], 'worker Web Stream')

  const csv = new TextEncoder().encode('a,b\n1,2\n')
  equal(await Exstream([csv]).csv({ header: true }).toPromise(), [{ a: '1', b: '2' }], 'worker CSV')

  postMessage({ checks: 3, ok: true })
}

run().catch((error) => postMessage({ error: error.stack || String(error), ok: false }))