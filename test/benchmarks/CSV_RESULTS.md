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
- source digest: `cbcdbe9e8a6f6ff1958d62e1e33adb192ebbb7fb7bcd60cf8128768bb4fb203d`

## Throughput

Values are median input MiB/s across three measured runs. Bold marks the best
result in each scenario on this machine.

| Scenario                                   |    Exstream | Node CSV | Fast-CSV | CSV Parser | Papa Parse |
| ------------------------------------------ | ----------: | -------: | -------: | ---------: | ---------: |
| Plain object parse, 500k rows              |  **148.63** |    37.72 |    26.15 |      88.00 |      76.55 |
| Quoted/escaped/multiline array parse, 100k |   **97.25** |    54.60 |    26.56 |          — |      92.81 |
| Quoted object parse, 7-byte chunks         |       18.14 |    13.29 |     1.92 |  **18.96** |       6.86 |
| Wide 64-column array parse                 |  **263.48** |    50.60 |    29.11 |          — |     247.03 |
| Plain object stringify, 500k               |  **102.52** |    70.68 |    71.54 |          — |          — |
| Quoted array stringify, 100k               |  **105.88** |    76.40 |    75.09 |          — |          — |
| Plain object pipeline, throttled writer    |        7.17 |     7.34 | **7.38** |          — |          — |
| Plain array parse, 1m rows                 |  **181.26** |    60.70 |    27.62 |          — |     155.21 |
| Narrow object parse, 5m rows               |       40.03 |    20.32 |    10.21 |  **42.83** |      13.16 |
| Quoted array parse, 3-byte chunks          |   **16.11** |    12.47 |     1.55 |          — |       4.69 |
| 8 records with 1 MiB fields                | **1079.37** |    36.62 |     0.85 |          — |      74.52 |
| Wide 64-column object stringify            |  **156.82** |    78.25 |   101.84 |          — |          — |
| Quoted object end-to-end pipeline          |   **68.68** |    29.39 |    21.87 |          — |          — |

Exstream has the highest median throughput in 10 of the 13 full-preset
scenarios. Among the eight parse scenarios, Exstream leads six and CSV Parser
two. Exstream is about 5% faster than Papa Parse on the general
quoted/escaped/multiline array case, 17% faster on plain arrays, 7% faster on
wide arrays, and 3.4 times as fast under three-byte fragmentation. CSV Parser is
about 5% faster than Exstream on quoted object parsing with seven-byte chunks
and 7% faster on five million narrow objects, while Exstream is about 69% faster
on the general plain-object case.

Compared with the preceding checked-in snapshot on the same machine and runtime,
the hybrid cell accumulator and indexed newline tracking raise Exstream from
90.82 to 97.25 MiB/s on the general quoted parse, from 17.86 to 18.14 MiB/s with
seven-byte chunks, from 15.44 to 16.11 MiB/s with three-byte chunks, and from
66.70 to 68.68 MiB/s in the quoted end-to-end pipeline. The quoted parse remains
close to Papa Parse, so a separate seven-run check was also made: its medians were
110.65 MiB/s for Exstream and 105.79 MiB/s for Papa Parse. Both measurements put
Exstream about 5% ahead on this machine.

Parse records are now observed in one common final object-mode sink instead of
through library-specific hooks. This removes a methodological asymmetry, but it
also means deltas against older parse snapshots include the observation change
and should not be read as isolated parser-only speedups. Median peak RSS delta is
17.77 MiB in the general quoted parse and 25.64 MiB in the quoted pipeline; the
latter remains below Node CSV at 30.92 MiB and Fast-CSV at 77.59 MiB.

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
|    50,000 | **20.64** |    51.16 |    52.31 |
|   500,000 | **79.63** |   110.64 |   134.20 |
| 5,000,000 | **81.98** |   134.02 |   131.53 |

Exstream's measured working-memory delta rises while the workload warms from
50k to 500k records, then remains close between 500k and 5m records instead of
tracking the tenfold dataset growth. At 5m rows the three implementations are
writer-limited to 6.6–6.8 MiB/s, while Exstream's median RSS delta is about
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