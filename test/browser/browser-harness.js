const assert = (condition, message) => {
  if (!condition) throw Error(message)
}

const equal = (actual, expected, message) => {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  assert(left === right, `${message}: expected ${right}, received ${left}`)
}

const run = async () => {
  const { default: ExstreamModule } = await import('./exstream.mjs')
  const hiddenMethods = ['abort', 'destroy', 'fail', 'pause', 'resume', 'writeData']
  const hiddenUtilities = ['curry', 'get', 'isExstream', 'isIterable']
  const empty = ExstreamModule()
  assert(
    hiddenMethods.every((name) => !(name in empty)) &&
      hiddenUtilities.every((name) => !(name in ExstreamModule)),
    'browser bundle exposes internal API',
  )
  equal(
    await ExstreamModule([1, 2, 3])
      .map((value) => value + 1)
      .toArray(),
    [2, 3, 4],
    'ES module',
  )
  let deferredInvocations = 0
  const deferred = ExstreamModule.defer(() => {
    deferredInvocations += 1
    return [4, 5]
  })
  assert(deferredInvocations === 0, 'deferred browser source started eagerly')
  equal(await deferred.toArray(), [4, 5], 'deferred browser source')
  assert(deferredInvocations === 1, 'deferred browser source did not start exactly once')

  const mapped = await Exstream([1, 2, 3])
    .mapAsync(async (value) => value * 10, { concurrency: 2 })
    .toArray()
  equal(mapped, [10, 20, 30], 'browser mapAsync')

  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(1)
      controller.enqueue(2)
      controller.close()
    },
  })
  equal(
    await Exstream(readable)
      .map((value) => value + 1)
      .toArray(),
    [2, 3],
    'web source',
  )

  const written = []
  const writable = new WritableStream({ write: (value) => written.push(value) })
  await Exstream([1, 2])
    .map((value) => value * 2)
    .pipeTo(writable)
  equal(written, [2, 4], 'web sink')

  const destinationOutput = []
  const destination = ExstreamModule.pipeline()
    .batch(2)
    .mapAsync(async (batch) => destinationOutput.push(batch))
    .drain()
  await ExstreamModule([1, 2, 3]).pipeTo(destination)
  equal(destinationOutput, [[1, 2], [3]], 'Exstream destination')

  let nodeTransformError
  try {
    ExstreamModule.pipeline().toNodeTransform()
  } catch (error) {
    nodeTransformError = error
  }
  assert(
    nodeTransformError?.message === 'toNodeTransform() is not available in this runtime',
    'browser pipeline rejects the Node transform adapter',
  )

  const target = new EventTarget()
  const events = Exstream.fromEvent(target, 'row', {
    end: 'complete',
    error: false,
    map: (event) => event.detail,
  })
  const eventResult = events.toArray()
  target.dispatchEvent(new CustomEvent('row', { detail: 7 }))
  target.dispatchEvent(new Event('complete'))
  equal(await eventResult, [7], 'EventTarget source')

  const encoder = new TextEncoder()
  const csv = encoder.encode('id💥name\n1💥Ada\n')
  const response = new Response(csv)
  const csvOutput = []
  await Exstream(response.body)
    .csv({ header: true, separator: '💥' })
    .map((row) => Object.assign(row, { id: Number(row.id) }))
    .pipeTo(new WritableStream({ write: (row) => csvOutput.push(row) }))
  equal(csvOutput, [{ id: 1, name: 'Ada' }], 'fetch body to CSV and Web sink')

  const json = encoder.encode('{"data":{"rows":[{"id":1},{"id":2}]}}')
  equal(
    await Exstream(new Response(json).body).json({ path: '$.data.rows[*]' }).toArray(),
    [{ id: 1 }, { id: 2 }],
    'fetch body to streaming JSON',
  )

  const jsonl = encoder.encode('{"id":1}\n{"id":2}\n')
  equal(
    await Exstream(new Response(jsonl).body).jsonl().toArray(),
    [{ id: 1 }, { id: 2 }],
    'fetch body to JSONL',
  )

  const envelope = await Exstream([{ id: 1 }, { id: 2 }])
    .jsonStringify({ path: '$.rows[*]', finalize: ({ count }) => ({ count }) })
    .toArray()
  equal(JSON.parse(envelope.join('')), { rows: [{ id: 1 }, { id: 2 }], count: 2 }, 'JSON envelope')

  let produced = 0
  const slowOutput = []
  const fastOutput = []
  function* values() {
    while (produced < 3) yield ++produced
  }
  const source = Exstream(values(), { start: 'manual' })
  const slowDone = source.fork().pipeTo(
    new WritableStream({
      async write(value) {
        slowOutput.push(value)
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
    }),
  )
  const fastDone = source
    .fork()
    .pipeTo(new WritableStream({ write: (value) => fastOutput.push(value) }))
  await source.start()
  await Promise.all([slowDone, fastDone])
  equal(slowOutput, [1, 2, 3], 'slow browser fork')
  equal(fastOutput, slowOutput, 'fast browser fork')

  const workerResult = await new Promise((resolve, reject) => {
    const worker = new Worker('./worker-harness.js')
    worker.addEventListener(
      'message',
      ({ data }) => {
        worker.terminate()
        if (data.ok) resolve(data)
        else reject(Error(data.error))
      },
      { once: true },
    )
    worker.addEventListener(
      'error',
      (event) => {
        worker.terminate()
        reject(event.error || Error(event.message))
      },
      { once: true },
    )
  })
  assert(workerResult.checks === 6, 'worker did not complete every check')

  document.body.textContent = 'EXSTREAM_BROWSER_PASS main=14 worker=6'
}

run().catch((error) => {
  document.body.textContent = `EXSTREAM_BROWSER_FAIL ${error.stack || error}`
})