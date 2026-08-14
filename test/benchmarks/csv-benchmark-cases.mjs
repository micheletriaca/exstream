const kib = 1024
const mib = 1024 * kib

const scenario = (definition) => ({
  chunkBytes: 64 * kib,
  throttleBytes: 0,
  throttleMs: 0,
  ...definition,
})

const smoke = [
  scenario({
    dataset: 'plain',
    description: 'Plain object-mode parsing',
    id: 'parse-plain-object',
    mode: 'object',
    operation: 'parse',
    rows: 1_000,
  }),
  scenario({
    dataset: 'quoted',
    description: 'Quoted, escaped, and multiline array serialization',
    id: 'stringify-quoted-array',
    mode: 'array',
    operation: 'stringify',
    rows: 1_000,
  }),
  scenario({
    dataset: 'plain',
    description: 'End-to-end object pipeline with a slow writer',
    id: 'pipeline-slow-object',
    mode: 'object',
    operation: 'pipeline',
    rows: 1_000,
    throttleBytes: 64 * kib,
    throttleMs: 8,
  }),
]

const quick = [
  scenario({
    dataset: 'plain',
    description: 'Plain object-mode parsing in large chunks',
    id: 'parse-plain-object',
    mode: 'object',
    operation: 'parse',
    rows: 500_000,
  }),
  scenario({
    dataset: 'quoted',
    description: 'Quoted, escaped, and multiline array parsing',
    id: 'parse-quoted-array',
    mode: 'array',
    operation: 'parse',
    rows: 100_000,
  }),
  scenario({
    chunkBytes: 7,
    dataset: 'quoted',
    description: 'Quoted object parsing with heavily fragmented input',
    id: 'parse-fragmented-object',
    mode: 'object',
    operation: 'parse',
    rows: 10_000,
  }),
  scenario({
    dataset: 'wide',
    description: 'Wide 64-column array parsing',
    id: 'parse-wide-array',
    mode: 'array',
    operation: 'parse',
    rows: 25_000,
  }),
  scenario({
    dataset: 'plain',
    description: 'Plain object-mode serialization',
    id: 'stringify-plain-object',
    mode: 'object',
    operation: 'stringify',
    rows: 500_000,
  }),
  scenario({
    dataset: 'quoted',
    description: 'Quoted, escaped, and multiline array serialization',
    id: 'stringify-quoted-array',
    mode: 'array',
    operation: 'stringify',
    rows: 100_000,
  }),
  scenario({
    dataset: 'plain',
    description: 'End-to-end object pipeline with a slow writer',
    id: 'pipeline-slow-object',
    mode: 'object',
    operation: 'pipeline',
    rows: 500_000,
    throttleBytes: 64 * kib,
    throttleMs: 8,
  }),
]

const full = [
  ...quick,
  scenario({
    dataset: 'plain',
    description: 'Plain array-mode parsing',
    id: 'parse-plain-array',
    mode: 'array',
    operation: 'parse',
    rows: 1_000_000,
  }),
  scenario({
    dataset: 'narrow',
    description: 'Five million narrow object records',
    id: 'parse-narrow-five-million',
    mode: 'object',
    operation: 'parse',
    rows: 5_000_000,
  }),
  scenario({
    chunkBytes: 3,
    dataset: 'quoted',
    description: 'Quoted array parsing with three-byte chunks',
    id: 'parse-fragmented-quoted-array',
    mode: 'array',
    operation: 'parse',
    rows: 50_000,
  }),
  scenario({
    chunkBytes: 4 * kib,
    dataset: 'large',
    description: 'Records containing a one-MiB field',
    id: 'parse-large-record-array',
    mode: 'array',
    operation: 'parse',
    payloadBytes: mib,
    rows: 8,
  }),
  scenario({
    dataset: 'wide',
    description: 'Wide 64-column object serialization',
    id: 'stringify-wide-object',
    mode: 'object',
    operation: 'stringify',
    rows: 100_000,
  }),
  scenario({
    dataset: 'quoted',
    description: 'End-to-end quoted object pipeline',
    id: 'pipeline-quoted-object',
    mode: 'object',
    operation: 'pipeline',
    rows: 250_000,
  }),
]

const memory = [50_000, 500_000, 5_000_000].map((rows) =>
  scenario({
    dataset: 'narrow',
    description: `Memory scaling under backpressure at ${rows} rows`,
    id: `memory-pipeline-${rows}`,
    mode: 'object',
    operation: 'pipeline',
    rows,
    throttleBytes: 64 * kib,
    throttleMs: 8,
  }),
)

export const presets = { full, memory, quick, smoke }

export const presetDefaults = {
  full: { measuredRuns: 3, memorySampleMs: 5, warmupRuns: 1 },
  memory: { measuredRuns: 3, memorySampleMs: 5, warmupRuns: 0 },
  quick: { measuredRuns: 3, memorySampleMs: 5, warmupRuns: 1 },
  smoke: { measuredRuns: 1, memorySampleMs: 5, warmupRuns: 0 },
}