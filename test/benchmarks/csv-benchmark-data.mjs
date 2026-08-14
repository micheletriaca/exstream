const definitions = {
  large: {
    headers: ['id', 'payload'],
    row(index, { payloadBytes = 1024 * 1024 }) {
      return [String(index), `${'x'.repeat(payloadBytes - 16)}-${index}`]
    },
  },
  narrow: {
    headers: ['id', 'value'],
    row: (index) => [String(index), String(index % 100)],
  },
  plain: {
    headers: ['id', 'name', 'description', 'active'],
    row: (index) => [
      String(index),
      `name-${index}`,
      `description-${index % 1000}`,
      String(index % 2 === 0),
    ],
  },
  quoted: {
    headers: ['id', 'name', 'description', 'active'],
    row: (index) => [
      String(index),
      `name,${index}`,
      index % 4 === 0
        ? `first line ${index}\nsecond line says "hello"`
        : `description "${index % 1000}"`,
      String(index % 2 === 0),
    ],
  },
  wide: {
    headers: Array.from({ length: 64 }, (_, index) => `column-${index}`),
    row: (index) => Array.from({ length: 64 }, (_, column) => `${index}-${column}`),
  },
}

const quoteCell = (value) => {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const encodeRow = (values) => `${values.map(quoteCell).join(',')}\n`

const toObject = (headers, values) =>
  Object.fromEntries(headers.map((header, index) => [header, values[index]]))

const createSamples = (definition, scenario) => {
  // A bounded pool avoids constructing millions of JS arrays/objects before a run.
  // Every library consumes the same repeatable sequence from the same pool.
  const maximumSamples =
    scenario.dataset === 'large' ? 4 : scenario.dataset === 'wide' ? 256 : 1_024
  const sampleCount = Math.min(scenario.rows, maximumSamples)
  const arrays = Array.from({ length: sampleCount }, (_, index) => definition.row(index, scenario))
  const values =
    scenario.mode === 'object' ? arrays.map((row) => toObject(definition.headers, row)) : arrays
  const records = arrays.map(encodeRow)
  return { records, values }
}

const measureInput = (headers, records, scenario) => {
  const headerBytes = scenario.mode === 'object' ? Buffer.byteLength(encodeRow(headers)) : 0
  const recordBytes = records.map((record) => Buffer.byteLength(record))
  const cycleBytes = recordBytes.reduce((sum, bytes) => sum + bytes, 0)
  const completeCycles = Math.floor(scenario.rows / records.length)
  const remainder = scenario.rows % records.length
  return (
    headerBytes +
    completeCycles * cycleBytes +
    recordBytes.slice(0, remainder).reduce((sum, bytes) => sum + bytes, 0)
  )
}

const createInput = (headers, records, scenario, inputBytes) => {
  if (scenario.operation === 'stringify') return null
  const chunks = []
  let parts = scenario.mode === 'object' ? [encodeRow(headers)] : []
  let bufferedBytes = parts.length === 0 ? 0 : Buffer.byteLength(parts[0])

  const flush = () => {
    if (parts.length === 0) return
    chunks.push(Buffer.from(parts.join('')))
    parts = []
    bufferedBytes = 0
  }

  const cycle = records.join('')
  const cycleBytes = Buffer.byteLength(cycle)
  const completeCycles = Math.floor(scenario.rows / records.length)
  for (let index = 0; index < completeCycles; index++) {
    parts.push(cycle)
    bufferedBytes += cycleBytes
    if (bufferedBytes >= 1024 * 1024) flush()
  }
  const remainder = scenario.rows % records.length
  if (remainder > 0) {
    const finalRecords = records.slice(0, remainder).join('')
    parts.push(finalRecords)
    bufferedBytes += Buffer.byteLength(finalRecords)
  }
  flush()
  return Buffer.concat(chunks, inputBytes)
}

export const createDataset = (scenario) => {
  const definition = definitions[scenario.dataset]
  if (!definition) throw Error(`unknown CSV benchmark dataset: ${scenario.dataset}`)
  const samples = createSamples(definition, scenario)
  const inputBytes = measureInput(definition.headers, samples.records, scenario)
  const input = createInput(definition.headers, samples.records, scenario, inputBytes)

  function* rows() {
    for (let index = 0; index < scenario.rows; index++) {
      yield samples.values[index % samples.values.length]
    }
  }

  return {
    headers: definition.headers,
    input,
    inputBytes,
    rows,
    sampleRows: samples.values.length,
  }
}

export function* chunkBuffer(buffer, chunkBytes) {
  for (let offset = 0; offset < buffer.length; offset += chunkBytes) {
    yield buffer.subarray(offset, Math.min(offset + chunkBytes, buffer.length))
  }
}