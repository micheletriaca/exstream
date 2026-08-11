# Performance baseline

Run the benchmark suite without changing the recorded baseline:

```shell
npm run benchmark
```

Regenerate `baseline.json` after an intentional performance change:

```shell
npm run benchmark:update
```

Run the isolated end-to-end CSV streaming comparison and regenerate
`streaming-csv-baseline.json`:

```shell
npm run benchmark:csv:stream
```

The CSV comparison feeds each library the same 500,000-row in-memory buffer in
64 KiB chunks, parses the header into objects, stringifies those objects, and
discards the output in a writable sink. It measures both an unrestricted sink
and a sink throttled to approximately 32 MiB/s. Each measured run uses a fresh
process; dataset generation and module loading happen before timing and before
the memory baseline. The runner checks the parsed row count and non-empty output.

The reported heap and RSS values are sampled 10 ms peak deltas, not exact
allocation totals. The entire input buffer is retained outside the measured
delta so the memory figure represents pipeline working memory.

Benchmark results depend on the Node.js version, operating system and CPU. Compare
results on equivalent environments; `baseline.json` records the environment used
for its generation.