const sumTo = (count) => (count * (count - 1)) / 2

function* syncRange(count) {
  for (let index = 0; index < count; index += 1) yield index
}

async function* asyncRange(count) {
  for (let index = 0; index < count; index += 1) yield index
}

const webRange = (count) => {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index >= count) {
        controller.close()
        return
      }
      controller.enqueue(index)
      index += 1
    },
  })
}

export const runtimeParityCases = [
  { id: 'sync-iterable', label: 'sync iterable', source: syncRange },
  { id: 'async-iterable', label: 'immediate async iterable', source: asyncRange },
  { id: 'web-readable', label: 'Web ReadableStream', source: webRange },
]

const median = (samples) => {
  const ordered = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle]
}

const runCase = async (exstream, benchmark, records) => {
  let consumed = 0
  const result = await exstream(benchmark.source(records))
    .tap(() => {
      consumed += 1
    })
    .reduce1((sum, value) => sum + value)
    .single()

  if (consumed !== records) {
    throw Error(`${benchmark.label} consumed ${consumed} records instead of ${records}`)
  }
  const expected = sumTo(records)
  if (result !== expected) {
    throw Error(`${benchmark.label} produced ${result} instead of ${expected}`)
  }
}

export const runRuntimeParityCases = async (exstream, { records, runs, runtime, warmups }) => {
  const results = []

  for (const benchmark of runtimeParityCases) {
    for (let index = 0; index < warmups; index += 1) {
      await runCase(exstream, benchmark, records)
    }

    const samplesMs = []
    for (let index = 0; index < runs; index += 1) {
      const startedAt = performance.now()
      await runCase(exstream, benchmark, records)
      samplesMs.push(performance.now() - startedAt)
    }

    const medianMs = median(samplesMs)
    results.push({
      id: benchmark.id,
      label: benchmark.label,
      medianMs,
      recordsPerSecond: records / (medianMs / 1_000),
      samplesMs,
    })
  }

  return { records, runs, runtime, warmups, cases: results }
}