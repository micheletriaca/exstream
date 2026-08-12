const assert = (condition, message) => {
  if (!condition) throw Error(message)
}

const equal = (actual, expected, message) => {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  assert(left === right, `${message}: expected ${right}, received ${left}`)
}

const run = async () => {
  const mapped = await Exstream([1, 2, 3])
    .mapAsync(async (value) => value * 10, { concurrency: 2 })
    .toPromise()
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
      .toPromise(),
    [2, 3],
    'web source',
  )

  const written = []
  const writable = new WritableStream({ write: (value) => written.push(value) })
  await Exstream([1, 2])
    .map((value) => value * 2)
    .pipe(writable)
  equal(written, [2, 4], 'web sink')

  const target = new EventTarget()
  const events = Exstream.fromEvent(target, 'row', {
    end: 'complete',
    error: false,
    map: (event) => event.detail,
  })
  const eventResult = events.toPromise()
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
    .pipe(new WritableStream({ write: (row) => csvOutput.push(row) }))
  equal(csvOutput, [{ id: 1, name: 'Ada' }], 'fetch body to CSV and Web sink')

  let produced = 0
  const slowOutput = []
  const fastOutput = []
  const source = Exstream((write, next) => {
    if (produced === 3) write(Exstream.nil)
    else {
      write(++produced)
      next()
    }
  })
  const slowDone = source.fork(true).pipe(
    new WritableStream({
      async write(value) {
        slowOutput.push(value)
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
    }),
  )
  const fastDone = source
    .fork(true)
    .pipe(new WritableStream({ write: (value) => fastOutput.push(value) }))
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
  assert(workerResult.checks === 3, 'worker did not complete every check')

  document.body.textContent = 'EXSTREAM_BROWSER_PASS main=6 worker=3'
}

run().catch((error) => {
  document.body.textContent = `EXSTREAM_BROWSER_FAIL ${error.stack || error}`
})