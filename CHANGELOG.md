# Changelog

This file records user-visible changes to `exstream.js`. Version 0.33.0 is the
first public release after 0.25.0 and consolidates the work developed through
the internal 0.26–0.33 milestones. npm releases and Git history remain the
authoritative record for earlier versions.

## [Unreleased]

### Added

- `mapAsync({ onFail })` adds per-record asynchronous recovery. A handler can
  retry the callback with the same or a replacement input, emit a fallback
  output, or propagate the failure to downstream error policy without releasing
  the record's concurrency slot.
- `defer(factory)` creates a source whose synchronous or asynchronous factory is
  invoked once, only after graph activation and downstream demand. It delays
  resource acquisition such as `fetch()` and `createReadStream()` rather than
  merely delaying reads from an already-created source.

### Changed

- Source adapters now acquire iterable iterators, async iterators, Web readers,
  and Node readable iterators on demand rather than during `exstream(source)`.
- `StreamOptions.start` selects automatic activation (the default) or an
  explicit manual graph-building phase. `start()` activates the root graph and
  freezes reliable fork registration, including when called through a
  transformed branch.

- Reusable pipelines expose `toNodeTransform()` as a native Node `Transform`
  adapter. It snapshots the operator definition, preserves Node backpressure and
  cancellation in both directions, and keeps input/output types distinct.
- Pipeline definitions now reject instance-only, terminal, adapter, and
  graph-specific methods immediately instead of recording invalid operator
  chains. Functional operators compose through `through()` on both live streams
  and reusable pipeline definitions without a global registry.
- Reusable pipelines can now be closed with `drain()` into a typed
  `Destination<Input>`. `pipeTo()` runs these high-level destinations with the
  same backpressure, error, and cancellation semantics as the connected graph;
  `destination()` adds per-run resource setup and cleanup without requiring a
  Node writable or Web `WritableStream` implementation.
- Terminal completion now has a uniform Promise contract through `toArray()`,
  `single()`, `drain()`, and `pipeTo()`.
- `mapAsync()` now treats `concurrency` as a sliding window of active work and
  completed results awaiting downstream demand. Each delivered result releases
  one slot immediately instead of refilling work in batches behind a slow sink.
- `merge()` is now lazy and uses a dedicated sliding coordinator. Unordered
  mode streams every active inner with bounded demand; ordered mode streams the
  current inner while eagerly buffering later active inners as protocol frames,
  preserving record errors, contexts, cancellation, and outer order. Wrap
  resource acquisition in `defer()` when it must wait for an activation slot.
- `sortedJoin()` is now a binary graph operation called on the left input with
  the right input and a named options object. Its merge-join coordinator
  propagates fatal failures and cancellation across both inputs, uses numeric
  comparator semantics for ordering and key equivalence, and emits duplicate
  products one record at a time under downstream demand.
- Exstream instances implement `Symbol.asyncIterator` directly.
- Node interoperability now uses the readable-only `toNodeReadable()` adapter;
  `toWebReadable()` remains the corresponding Web Streams adapter.
- `through()` now types native Node duplex and transform targets, including the
  value type exposed by their readable side.
- `mapAsync()` failures now record the `mapAsync` operator stage before
  cancellation propagates through the graph.

### Fixed

- Async iterables and Web `ReadableStream` sources now continue through
  microtasks within a bounded execution slice, then yield through `setImmediate`
  in Node or a cancellable `MessageChannel` task in browsers. This removes the
  per-record task cost without starving timers, I/O, rendering, or cancellation.
- `makeAsync()` now includes record errors and work performed by the first
  record after a yield in its synchronous execution budget.

### Removed

- Standalone and curried operator exports such as `map()`, `filter()`, `json()`,
  and `reduce()`. Operators remain available as Exstream instance methods and
  on reusable definitions created with `pipeline()`.
- The overlapping `toPromise()`, `values()`, `valuesSync()`, callback
  `toArray()`, `value()`, `each()`, `pull()`, `pipe()`, `toAsyncIterator()`, and
  `toNodeStream()` APIs.
- `resolve()`, `massThen()`, and `massCatch()`; use `mapAsync()` for asynchronous
  transformations, concurrency, and ordering.
- `asyncFilter()` and `asyncReduce()`. Use `mapAsync()` before synchronous
  selection or reduction when work is independent; use `for await` for a
  genuinely sequential asynchronous fold.
- Stream factories as `merge()` inputs. `merge()` now accepts only Exstreams;
  wrap lazy acquisition in `defer()` before merging.
- The positional `exstream([left, right]).sortedJoin(...)` form, the standalone
  curried `sortedJoin()` export, and its `buffer` argument. Use
  `left.sortedJoin(right, { leftKey, rightKey, type, order })`.
- Standalone and curried terminal exports. Terminal operations are instance
  methods in 1.0.
- Public `pause()`, `resume()`, `fail()`, `destroy()`, and `abort()` lifecycle
  controls. Backpressure and graph shutdown are now owned by terminals,
  adapters, and `AbortSignal` instead of exposing scheduler internals on every
  stream instance.
- `writeData()`; wrap values with `data()` and pass them to `write()` when an
  `Error` must travel as ordinary data.
- Generic utility and internal type-guard exports such as `curry()`, `get()`,
  `isIterable()`, and `isExstream()`. They remain implementation details rather
  than part of the 1.0 package contract.
- The positional `fork(true)` autostart switch. Use `{ start: 'manual' }` on the
  source and call `start()` after every reliable branch is registered.
- Callback sources using `(write, next) => void`, including the overloaded
  `next(otherSource)` handoff. Use iterables or async iterables for pull-based
  sources, `yield*` for delegation, and `exstream()` or `fromEvent()` for
  push-based adapters.
- `extend()`. Export custom operators as ordinary `Exstream → Exstream`
  functions and compose them locally with `through()` instead of mutating every
  Exstream instance and the reusable-pipeline registry.
- `Pipeline.generateStream()` and the mutable `Pipeline.definitions` array.
  Attach reusable definitions with `through()`; pipeline instantiation and
  recorded operators are now private implementation details.
- Public graph and scheduler internals `source`, `endOfChain`,
  `pausedFromInside`, and `pausedFromOutside`. Lifecycle state, aggregate
  pressure, cancellation, and buffer metrics remain available for diagnostics.

## [0.34.0] - 2026-08-16

### Added

- `pipeTo()` as a strict Promise-based terminal for Node and Web writable
  streams. It respects backpressure, waits for accepted writes and destination
  completion, supports cancellation and destination ownership options, and
  keeps sink failures local to the connected branch.
- `drain()` as a Promise-based terminal for running a pipeline to completion
  while discarding its output, including functional and typed ESM forms.
- `errorInfo()` and non-enumerable error provenance for distinguishing source,
  operator, format, sink and lifecycle failures by origin and stage without
  replacing the original error or losing its input record.

### Changed

- Structural CSV and JSON document failures now terminate their parser or
  serializer branch even when a record-error handler is present.
- JSON Lines syntax and serialization errors remain recoverable per record when
  the next line can be processed safely; decoding and size failures terminate
  the branch.
- Source, operator, format, sink and lifecycle boundaries now preserve the first
  known error provenance while errors travel through the graph.

### Fixed

- `pipeTo()` releases its listeners, writer locks and cancellation hooks after
  success or failure, and rejects when a destination closes before its source.
- A failed `pipeTo()` destination cancels only its own fork, allowing reliable
  sibling branches to continue consuming their data.

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