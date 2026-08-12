# CSV benchmark snapshot

This snapshot summarizes `csv-benchmark-full.json` and
`csv-benchmark-memory.json`, generated on 2026-08-13. It is evidence for this
machine and runtime, not a universal ranking.

- Apple M5, 10 logical CPUs, 24 GiB RAM
- macOS 25.5.0 arm64
- Node.js 26.4.0
- Exstream 0.27.0 working tree
- Node CSV: `csv-parse` 7.0.2 / `csv-stringify` 6.8.3
- Fast-CSV 5.0.7
- CSV Parser 3.2.1 (object-mode parsing only)
- Papa Parse 5.5.4 (parsing only)
- one warmup and three measured fresh processes for the full preset
- source digest: `b41fb6cee222fa001267ab7c4216be062c11c93c021102dd0b84b8631d028008`

## Throughput

Values are median input MiB/s across three measured runs. Bold marks the best
result in each scenario on this machine.

| Scenario                                   |    Exstream | Node CSV | Fast-CSV | CSV Parser | Papa Parse |
| ------------------------------------------ | ----------: | -------: | -------: | ---------: | ---------: |
| Plain object parse, 500k rows              |  **144.66** |    38.16 |    28.36 |      90.18 |     114.19 |
| Quoted/escaped/multiline array parse, 100k |       62.56 |    59.18 |    29.60 |          — | **111.66** |
| Quoted object parse, 7-byte chunks         |       15.70 |    14.32 |     2.11 |  **20.49** |       8.11 |
| Wide 64-column array parse                 |  **270.38** |    54.01 |    32.00 |          — |     260.57 |
| Plain object stringify, 500k               |  **109.69** |    77.14 |    77.26 |          — |          — |
| Quoted array stringify, 100k               |  **110.34** |    84.68 |    83.71 |          — |          — |
| Plain object pipeline, throttled writer    |        6.75 |     7.28 | **7.34** |          — |          — |
| Plain array parse, 1m rows                 |      167.43 |    58.06 |    29.00 |          — | **206.22** |
| Narrow object parse, 5m rows               |       36.94 |    19.01 |    10.43 |  **42.09** |      35.80 |
| Quoted array parse, 3-byte chunks          |   **12.68** |    12.39 |     1.57 |          — |       4.96 |
| 8 records with 1 MiB fields                | **1124.25** |    37.07 |     0.88 |          — |      79.14 |
| Wide 64-column object stringify            |  **163.60** |    82.39 |   105.26 |          — |          — |
| Quoted object end-to-end pipeline          |   **45.02** |    30.39 |    23.01 |          — |          — |

Exstream has the highest median throughput in 8 of the 13 full-preset
scenarios. Among the eight parse scenarios, Exstream leads four, Papa Parse two,
and CSV Parser two. Papa Parse is about 1.8 times as fast as Exstream on the
general quoted/escaped/multiline array case and about 23% faster on plain arrays;
the two are within 4% on wide arrays. That advantage reverses under three-byte
fragmentation, where Exstream is about 2.6 times as fast as Papa Parse. CSV Parser
is about 30% faster than Exstream on quoted object parsing with seven-byte chunks
and 14% faster on five million narrow objects, while Exstream is about 60% faster
on the general plain-object case.

CSV Parser is absent from array scenarios because its native API always emits
objects from a header row. Both parse-only libraries are absent from stringify
and pipeline scenarios; no compatibility work is added to make them participate.
The throttled pipeline deliberately makes the writer, rather than parsing speed,
the bottleneck: the three compatible implementations converge around 7 MiB/s
there, while their memory use remains distinguishable.

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
|    50,000 | **23.16** |    50.03 |    52.47 |
|   500,000 | **78.72** |   110.67 |   106.28 |
| 5,000,000 | **81.50** |   131.61 |   132.92 |

Exstream's measured working-memory delta rises while the workload warms from
50k to 500k records, then remains close between 500k and 5m records instead of
tracking the tenfold dataset growth. At 5m rows the three implementations are
writer-limited to 6.7–6.9 MiB/s, while Exstream's median RSS delta is about
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