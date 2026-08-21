# Exstream Pipeline Semantics

Use this reference to resolve architectural choices. Verify exact signatures against the installed package or the repository's `types/index.d.ts`.

## Source selection

| Input                         | Construction                            | Important behavior                                                                 |
| ----------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| Iterable or async iterable    | `exstream(input)`                       | Pulled on downstream demand; early cancellation closes the iterator when possible. |
| Existing Node or Web readable | `exstream(readable)`                    | Uses the platform pressure and cancellation boundary.                              |
| Promise                       | `exstream(promise)`                     | One eager value; the promise itself is not cancellable.                            |
| Resource-producing factory    | `exstream.defer(factory)`               | Acquires once after graph activation and downstream demand.                        |
| Event target or emitter       | `exstream.fromEvent(...)`               | Hot source; choose finite buffering and overflow deliberately.                     |
| Application-fed source        | `exstream()` plus `write()` and `end()` | The producer owns shutdown and must respect the boolean from `write()`.            |

`defer()` controls when acquisition happens. `{ start: 'manual' }` controls when an asynchronously assembled graph becomes closed to new reliable forks. These solve different problems.

## Transformation selection

| Need                                           | Preferred form                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Cheap value conversion or selection            | `map()`, `filter()`, or another synchronous operator                          |
| Independent asynchronous work per record       | `mapAsync(fn, { concurrency, ordered, ... })`                                 |
| Dependent asynchronous accumulation            | `for await` with an explicitly awaited accumulator                            |
| Fixed reusable operator chain                  | `exstream.pipeline()` and `through()`                                         |
| Parameterized or conditional composition       | ordinary function returning a transformed Exstream, attached with `through()` |
| Custom operator not expressible by composition | `consumeSync()` or `consume()` after checking lifecycle requirements          |
| Reusable terminal behavior                     | `exstream.destination()` or `pipeline().drain()`                              |

`mapAsync()` counts active callbacks, retry delays, and completed results awaiting downstream demand inside its concurrency window. `ordered: true` preserves input order and is the default; `ordered: false` lowers head-of-line blocking when records are independent and reordering is acceptable.

Forward `context.signal` into `fetch`, database clients, and other cancellable APIs. A timeout or cancelled branch otherwise stops accepting the result but may leave external work running.

## Responsibility boundaries

Treat an Exstream program as a composed graph with four responsibilities. These are design boundaries, not a requirement to create four files.

| Layer          | Owns                                                                                              | Avoid placing here                                                |
| -------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Source         | Resource acquisition, transport adapters, structural parsing, source cleanup                      | Business normalization, database writes, terminal execution       |
| Transformation | Pure validation, coercion, normalization, filtering, and domain mapping                           | Resource lifecycle, destination policy, terminal execution        |
| Destination    | Batching, external writes, transactions, idempotency, destination-specific retry, cleanup         | Source acquisition, unrelated domain mapping, graph orchestration |
| Orchestrator   | Composition, branches, delivery and error policy, cancellation, terminals, coordinated completion | Reusable parsing or domain rules hidden inside terminal callbacks |

Inspect the consuming project before inventing infrastructure. Reuse its schema validator, database client, transaction helper, logger, and error vocabulary when they fit. A schema library such as Ajv can keep a wide CSV contract declarative, but parsing and coercion policy must remain explicit: schema validation does not decide whether an empty string means `null`, whether a malformed amount is recoverable, or which record identity belongs in a dead letter.

Extract a module when a boundary has its own dependency, lifecycle, policy, reuse, or independently valuable tests. Keep small local chains inline when extraction would only scatter operators without clarifying ownership.

## Memory and aggregation

Most operators are incremental. Whole-input operators and terminals are intentional memory boundaries:

- `collect()` and `toArray()` retain every result.
- `sort()`, `groupBy()`, and `keyBy()` require the complete input.
- `last()` retains one value; `reduce()` retains one accumulator.
- `batch(n)` retains at most one batch per active flow position.
- `sortedGroupBy()` and `sortedJoin()` stay incremental only when their input ordering preconditions hold.

Never describe a complete pipeline as bounded merely because its source and `mapAsync()` are bounded; inspect every aggregation, branch buffer, merge window, and destination.

## Record errors and fatal failures

A callback throw or rejected `mapAsync()` promise becomes a record error associated with its input. Normal operators skip that record until a downstream error policy handles it.

- `errors(handler)`: replace, drop, or forward selected record errors.
- `skipErrors(predicate?)`: explicitly drop matching record errors.
- `routeErrors()`: split successful data and dead letters into separate consuming branches.
- `stopOnError(handler)`: handle the first record error and terminate that branch.
- `failOnError()`: promote the first record error to fatal graph failure.

If a record error reaches a terminal unhandled, that terminal rejects and aborts its consumer branch. Fatal source, structural parser, destination, lifecycle, and cancellation failures bypass record-error recovery where the graph cannot safely continue.

Use `exstream.errorInfo(error)` for diagnostic `origin`, `stage`, and input metadata. Do not use provenance as the business recovery policy.

## Branching and delivery

`fork()` is reliable: each branch contributes backpressure, so the shared source advances only when every reliable branch can make progress. Use it for required delivery.

`observe({ bufferLimit, overflow })` is non-blocking: it cannot slow the reliable flow and may lose data according to policy. Use it for metrics, sampling, and diagnostics only.

If reliable branches are attached across an `await`, create the root with `{ start: 'manual' }`, start each terminal, attach every fork, then call `start()` and await all terminal promises. A fork created after activation is not a replay subscription.

## Terminals and adapters

| Goal                                                     | Terminal or adapter                 |
| -------------------------------------------------------- | ----------------------------------- |
| Process records in application code                      | `for await (const value of stream)` |
| Write to Node, Web, or Exstream destination              | `await stream.pipeTo(destination)`  |
| Execute side effects and discard output                  | `await stream.drain()`              |
| Materialize finite output                                | `await stream.toArray()`            |
| Require zero or one value                                | `await stream.single()`             |
| Expose a live source as Node readable                    | `stream.toNodeReadable()`           |
| Expose a live source as Web readable                     | `stream.toWebReadable()`            |
| Turn a source-free reusable pipeline into Node Transform | `pipeline.toNodeTransform()`        |

Completion methods return promises even when all upstream transformations are synchronous. Await them for success, failure, cancellation, destination completion, and cleanup.

## Runtime boundaries

- `exstream.js` selects the Node or browser export through package conditions.
- `exstream.js/node` explicitly selects Node behavior.
- `exstream.js/core` and `exstream.js/web` select the portable runtime.
- Node stream conversion and Node-only encodings are unavailable in portable entry points.
- The portable runtime expects modern Web Streams, `AbortController`, `EventTarget`, `TextEncoder`, and `TextDecoder` without installing global polyfills.

## When not to use Exstream

Small input size alone is not a reason to avoid Exstream. Distinguish the cost of introducing an abstraction from the value of using one that the project already shares.

- Do not add Exstream solely for a trivial finite transformation that native arrays, a straightforward `for await` loop, or platform streams express more clearly.
- When Exstream is already a project-standard abstraction and the work is conceptually a source-to-operators-to-terminal flow, use it even for small inputs when that improves API uniformity, separation of responsibilities, reusable composition, or likely future evolution.
- Keep native JavaScript for local in-memory collection manipulation and dependent sequential logic when it remains materially clearer. Do not pursue syntactic uniformity outside the data-flow boundary.

Prefer a durable broker when a hot source cannot pause, records may not be lost, and process memory cannot provide the required durability. Prefer analytical engines such as DuckDB, Polars, or Arrow for large columnar joins and scans.