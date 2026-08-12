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
- source digest: `c6488c5cfaeae68a4515649f54dbe5366b79fadab80238361a07d316f0211a3b`

## Throughput

Values are median input MiB/s across three measured runs. Bold marks the best
result in each scenario on this machine.

| Scenario                                   |    Exstream | Node CSV | Fast-CSV | CSV Parser | Papa Parse |
| ------------------------------------------ | ----------: | -------: | -------: | ---------: | ---------: |
| Plain object parse, 500k rows              |  **142.62** |    38.53 |    27.99 |      88.81 |     112.96 |
| Quoted/escaped/multiline array parse, 100k |       90.82 |    58.67 |    29.15 |          — | **110.62** |
| Quoted object parse, 7-byte chunks         |       17.86 |    13.67 |     2.02 |  **18.33** |       7.76 |
| Wide 64-column array parse                 |  **271.75** |    54.99 |    32.66 |          — |     257.91 |
| Plain object stringify, 500k               |  **108.86** |    78.24 |    76.86 |          — |          — |
| Quoted array stringify, 100k               |  **111.43** |    84.62 |    83.70 |          — |          — |
| Plain object pipeline, throttled writer    |        6.81 |     6.90 | **7.03** |          — |          — |
| Plain array parse, 1m rows                 |      166.45 |    57.68 |    28.77 |          — | **201.38** |
| Narrow object parse, 5m rows               |       36.90 |    19.16 |    10.77 |  **42.76** |      35.42 |
| Quoted array parse, 3-byte chunks          |   **15.44** |    12.52 |     1.54 |          — |       5.00 |
| 8 records with 1 MiB fields                | **1054.16** |    37.48 |     0.90 |          — |      78.88 |
| Wide 64-column object stringify            |  **162.93** |    82.29 |   106.08 |          — |          — |
| Quoted object end-to-end pipeline          |   **66.70** |    30.88 |    23.72 |          — |          — |

Exstream has the highest median throughput in 8 of the 13 full-preset
scenarios. Among the eight parse scenarios, Exstream leads four, Papa Parse two,
and CSV Parser two. Papa Parse is about 22% faster than Exstream on the general
quoted/escaped/multiline array case and 21% faster on plain arrays; Exstream is
about 5% faster on wide arrays. That advantage reverses under three-byte
fragmentation, where Exstream is about 3.1 times as fast as Papa Parse. CSV Parser
is about 3% faster than Exstream on quoted object parsing with seven-byte chunks
and 16% faster on five million narrow objects, while Exstream is about 60% faster
on the general plain-object case.

Compared with the preceding checked-in snapshot on the same machine and runtime,
the indexed, stateful quoted scanner raises Exstream from 62.56 to 90.82 MiB/s on
the general quoted parse, from 15.70 to 17.86 MiB/s with seven-byte chunks, from
12.68 to 15.44 MiB/s with three-byte chunks, and from 45.02 to 66.70 MiB/s in the
quoted end-to-end pipeline. The larger decoded blocks trade memory for that
throughput: median peak RSS delta rises from 11.69 to 17.30 MiB in the quoted
parse and from 12.36 to 25.59 MiB in the quoted pipeline. The latter remains below
Node CSV at 29.41 MiB and Fast-CSV at 77.17 MiB.

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
|    50,000 | **20.31** |    51.36 |    51.66 |
|   500,000 | **79.72** |   110.52 |   107.89 |
| 5,000,000 | **81.50** |   132.50 |   131.67 |

Exstream's measured working-memory delta rises while the workload warms from
50k to 500k records, then remains close between 500k and 5m records instead of
tracking the tenfold dataset growth. At 5m rows the three implementations are
writer-limited to 6.5–7.0 MiB/s, while Exstream's median RSS delta is about
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