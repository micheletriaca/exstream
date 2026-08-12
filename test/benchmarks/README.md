# Performance baselines

## Core operators

Run the core benchmark suite without changing the recorded baseline:

```shell
npm run benchmark
```

Regenerate `baseline.json` after an intentional performance change:

```shell
npm run benchmark:update
```

## Reproducible CSV comparison

The CSV harness compares Exstream with the exact Node CSV and Fast-CSV versions
pinned in `package-lock.json`. Every sample runs sequentially in a fresh process
with `--expose-gc`; library order rotates between rounds. Dataset construction,
module loading, and two explicit collections happen before the memory baseline
and before timing. The measured interval covers source, parser and/or serializer,
stream plumbing, and the final sink.

Run the default comparison and write `csv-benchmark-quick.json`:

```shell
npm run benchmark:csv:stream
```

The quick preset covers plain object parsing, quoted/escaped/multiline arrays,
seven-byte fragmented chunks, 64-column rows, object and array serialization,
and an end-to-end pipeline with a throttled writer. It performs one warmup and
records the median and all samples from three measured runs.

The full preset adds one million plain rows, five million narrow rows,
three-byte fragmentation, one-MiB fields, wide object serialization, and a
quoted end-to-end pipeline:

```shell
npm run benchmark:csv:full
```

The memory preset compares 50,000, 500,000, and 5,000,000 rows under the same
backpressured writer:

```shell
npm run benchmark:csv:memory
```

`npm run benchmark:csv:smoke` is the short functional check used by the test
suite. Individual cases and libraries can be selected without writing a report:

```shell
node test/benchmarks/streaming-csv.mjs \
  --preset=full \
  --case=parse-fragmented-quoted-array \
  --library=exstream \
  --runs=1 \
  --warmups=0 \
  --json \
  --no-write
```

Available library ids are `exstream`, `node-csv`, and `fast-csv`. Use
`--output=path/to/report.json` to choose the report path.

### Datasets and fairness

CSV input is generated deterministically and retained outside the measured
working-memory delta. Serializer sources repeat a bounded deterministic pool of
rows so the five-million-row cases do not first allocate five million objects.
Every worker verifies the exact processed record count and requires at least one
output chunk. Parse and pipeline scenarios receive identical bytes and chunk
sizes; serializer scenarios receive the same values and headers.

The report contains:

- elapsed time, records/s, input and output MiB/s;
- latency to the first parsed record and first sink output;
- starting, absolute peak, and delta heap/RSS;
- peak deltas for external and ArrayBuffer memory;
- observed GC count and duration;
- dataset and library setup time outside the measured interval;
- CPU, core count, total memory, OS, architecture, and Node version;
- pinned library versions, complete scenarios, command, and run configuration.
- a SHA-256 digest and list of the source, harness, manifest, and lock files used.

Node.js has no stable public API for exact per-pipeline allocation count or
volume, so those fields are explicitly `null`. Sampled memory peaks and GC
activity are recorded as measurable substitutes; they must not be described as
exact allocation totals.

Results are machine- and runtime-dependent. Compare reports generated on
equivalent hardware and Node versions, and use the raw samples rather than a
single run when making performance claims.

The checked-in [CSV benchmark snapshot](./CSV_RESULTS.md) summarizes the latest
full and memory reports without replacing their raw samples.