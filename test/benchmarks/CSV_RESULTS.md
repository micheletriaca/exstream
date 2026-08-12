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
- source digest: `19372fc731e5ff3a446ae31eabb2906438df9a88de3cfce95b1637d5dc6574fc`

## Throughput

Values are median input MiB/s across three measured runs. Bold marks the best
result in each scenario on this machine.

| Scenario                                   |    Exstream | Node CSV | Fast-CSV |
| ------------------------------------------ | ----------: | -------: | -------: |
| Plain object parse, 500k rows              |  **143.85** |    37.62 |    26.87 |
| Quoted/escaped/multiline array parse, 100k |   **60.55** |    57.97 |    28.35 |
| Quoted object parse, 7-byte chunks         |   **15.09** |    13.95 |     2.02 |
| Wide 64-column array parse                 |  **269.77** |    54.09 |    31.68 |
| Plain object stringify, 500k               |  **108.26** |    77.72 |    76.85 |
| Quoted array stringify, 100k               |  **109.67** |    85.11 |    82.18 |
| Plain object pipeline, throttled writer    |        7.11 |     7.26 | **7.34** |
| Plain array parse, 1m rows                 |  **166.96** |    57.06 |    28.44 |
| Narrow object parse, 5m rows               |   **36.76** |    18.74 |    10.44 |
| Quoted array parse, 3-byte chunks          |   **12.77** |    12.42 |     1.55 |
| 8 records with 1 MiB fields                | **1071.38** |    36.65 |     0.88 |
| Wide 64-column object stringify            |  **159.11** |    81.99 |   104.88 |
| Quoted object end-to-end pipeline          |   **44.66** |    30.72 |    22.75 |

Exstream has the highest median throughput in 12 of the 13 full-preset
scenarios, including the general quoted/escaped/multiline parse and both
heavily fragmented quoted cases. Fast-CSV slows substantially under three- and
seven-byte fragmentation. The throttled pipeline deliberately makes the
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
|    50,000 | **20.70** |    51.41 |    51.63 |
|   500,000 | **79.64** |   110.80 |   133.92 |
| 5,000,000 | **81.61** |   133.23 |   131.64 |

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