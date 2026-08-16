# Changelog

This file records user-visible changes to `exstream.js`. Version 0.33.0 is the
first public release after 0.25.0 and consolidates the work developed through
the internal 0.26–0.33 milestones. npm releases and Git history remain the
authoritative record for earlier versions.

## Unreleased

### Added

- `pipeTo()` as a strict Promise-based terminal for Node and Web writable
  streams, with backpressure, coordinated cleanup and branch-local destination
  failure.
- `errorInfo()` and non-enumerable error provenance for distinguishing source,
  operator, format, sink and lifecycle failures without replacing the original
  error.

### Changed

- Structural CSV and JSON document failures now terminate their parser or
  serializer branch even when a record-error handler is present.
- JSON Lines syntax and serialization errors remain recoverable per record when
  the next line can be processed safely; decoding and size failures terminate
  the branch.

## [0.33.0] - 2026-08-14

### Added

- `mapAsync()` with bounded concurrency, ordered or completion-order output,
  per-attempt timeouts, retry policies and cancellation signals.
- Pull-based async iteration through `toAsyncIterator()` and an explicit
  `valuesSync()` sink for pipelines that must remain synchronous.
- Per-record context with `withContext()` and `extendContext()`, branch-local
  copies, aggregate parent contexts and cancellation signals.
- Explicit policies for recoverable record errors and fatal graph failures,
  including `skipErrors()`, `failOnError()`, `routeErrors()` and `data()` for
  transporting `Error` instances as ordinary values.
- Buffer limits, overflow policies and metrics for non-blocking observers.
- Portable browser and core entry points with Web Stream, async iterable,
  `EventTarget`, `AbortController`, `TextEncoder` and `TextDecoder` support.
- Streaming JSON Lines parsing and serialization for string and byte chunks.
- Streaming JSON selection through a forward-only JSONPath subset, plus
  incremental JSON arrays and object envelopes with asynchronous final
  properties.
- TypeScript declarations whose value and record-context types evolve through
  chained operators, with generated API-reference support.
- Typed CommonJS, ESM, Node.js, core and browser package entry points. Named ESM
  exports share the same underlying module instance as the default export.

### Changed

- Stream lifecycle, backpressure and graph cleanup are now explicit and
  idempotent across sources, consumers, forks, observers and piping adapters.
- CSV parsing and serialization now handle arbitrary chunk boundaries,
  multiline values, UTF-8 multi-character separators, UTF-16LE on Node.js,
  configurable record and column limits, and errors with exact input position.
- `fork()` is the reliable fan-out primitive; `observe()` remains non-blocking
  and makes buffering and loss policy visible.
- Asynchronous consumption and scheduling use shared concurrency and monotonic
  timing primitives instead of operator-specific coordination.
- The default package export selects the correct Node.js or browser runtime
  without installing implicit polyfills.
- Node.js 22 or newer is now required.

### Fixed

- Invalid operator arguments now fail immediately and consistently.
- Promise rejections, including non-`Error` rejection reasons, retain their
  input record and follow the documented record-error policy.
- Ending, destroying or aborting a graph releases pending generators, iterators,
  pipes, timers, observers and fork resources without duplicate terminal events.
- CSV parsing accepts custom separators whose code points or tokens span input
  chunks and reports malformed quoted input consistently.

### Performance

- Preserve specialized synchronous fast paths for the common `map()` and
  `filter()` cases even when record context support is available.
- Replace per-character CSV parsing work with indexed token scanning and a
  bounded hybrid field accumulator, substantially improving quoted workloads
  without changing the parser state machine.
- Precompile streaming JSON paths, scan ordinary spans in batches and avoid
  `JSON.parse()` for unescaped strings while preserving exact error locations.
- Add reproducible throughput, latency and peak-memory benchmarks for core,
  CSV and JSON pipelines, including comparisons with established parsers.