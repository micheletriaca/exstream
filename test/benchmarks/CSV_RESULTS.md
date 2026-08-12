# CSV benchmark snapshot

This snapshot summarizes `csv-benchmark-full.json` and
`csv-benchmark-memory.json`, generated on 2026-08-12. It is evidence for this
machine and runtime, not a universal ranking.

- Apple M5, 10 logical CPUs, 24 GiB RAM
- macOS 25.5.0 arm64
- Node.js 26.4.0
- Exstream 0.27.0 working tree
- Node CSV: `csv-parse` 7.0.2 / `csv-stringify` 6.8.3
- Fast-CSV 5.0.7
- one warmup and three measured fresh processes for the full preset
- source digest: `d50b045f7ff74b30178799a7529bb2d0fcc7b1364745d2419feceaeaf6cdc78d`

## Throughput

Values are median input MiB/s across three measured runs. Bold marks the best
result in each scenario on this machine.

| Scenario                                   |    Exstream |  Node CSV | Fast-CSV |
| ------------------------------------------ | ----------: | --------: | -------: |
| Plain object parse, 500k rows              |  **144.41** |     38.72 |    28.14 |
| Quoted/escaped/multiline array parse, 100k |       41.00 | **59.11** |    29.61 |
| Quoted object parse, 7-byte chunks         |       12.97 | **13.60** |     2.03 |
| Wide 64-column array parse                 |  **267.76** |     54.85 |    32.56 |
| Plain object stringify, 500k               |  **109.11** |     76.36 |    76.85 |
| Quoted array stringify, 100k               |  **110.38** |     85.43 |    82.96 |
| Plain object pipeline, throttled writer    |        6.76 |      7.29 | **7.35** |
| Plain array parse, 1m rows                 |  **168.64** |     58.47 |    29.30 |
| Narrow object parse, 5m rows               |   **37.15** |     19.00 |    10.70 |
| Quoted array parse, 3-byte chunks          |       11.47 | **12.71** |     1.60 |
| 8 records with 1 MiB fields                | **1077.19** |     37.36 |     0.89 |
| Wide 64-column object stringify            |  **162.90** |     81.25 |   106.38 |
| Quoted object end-to-end pipeline          |   **33.54** |     30.87 |    23.59 |

Exstream has the highest median throughput in 9 of the 13 full-preset
scenarios. Node CSV leads the general quoted/escaped/multiline parse and is
slightly ahead under three- and seven-byte fragmentation; Fast-CSV slows
substantially in those cases. The throttled pipeline deliberately makes the
writer, rather than parsing speed, the bottleneck: all three implementations
converge around 7 MiB/s there, while their memory use remains distinguishable.

The one-MiB-field result specifically measures large, unquoted records split
into 4 KiB views of one contiguous input buffer. Exstream can reconstruct each
record as a zero-copy view before decoding. Producers that deliver unrelated
backing stores use the tested single-concatenation fallback and should be
measured separately before applying that number to them.

## Memory under backpressure

Values are median peak RSS deltas in MiB. The full input is retained before the
memory baseline, so these figures describe additional process memory observed
while the source-to-parser-to-serializer-to-throttled-sink pipeline runs.

|      Rows |  Exstream | Node CSV | Fast-CSV |
| --------: | --------: | -------: | -------: |
|    50,000 | **21.05** |    50.56 |    51.92 |
|   500,000 | **78.38** |   110.88 |   109.75 |
| 5,000,000 | **81.81** |   130.39 |   131.41 |

Exstream's measured working-memory delta rises while the workload warms from
50k to 500k records, then remains close between 500k and 5m records instead of
tracking the tenfold dataset growth. At 5m rows the three implementations are
writer-limited to 6.7–7.0 MiB/s, while Exstream's median RSS delta is about
50 MiB lower.

## Reproduction and raw evidence

See [README.md](./README.md) for methodology and commands. The JSON reports
contain all samples, elapsed time, records/s, first-record and first-output
latency, absolute and delta heap/RSS, external and ArrayBuffer deltas, GC
activity, complete scenario configuration, hardware, Node version, pinned
library versions, and the exact source-file list and digest shown above.

Exact allocation count and volume are `null`: Node.js exposes no stable public
per-pipeline allocation counter. The sampled memory and GC metrics are useful
substitutes, not exact allocation totals.