# Performance baseline

Run the benchmark suite without changing the recorded baseline:

```shell
npm run benchmark
```

Regenerate `baseline.json` after an intentional performance change:

```shell
npm run benchmark:update
```

Benchmark results depend on the Node.js version, operating system and CPU. Compare
results on equivalent environments; `baseline.json` records the environment used
for its generation.