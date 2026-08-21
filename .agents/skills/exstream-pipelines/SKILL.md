---
name: exstream-pipelines
description: Design, implement, review, debug, and migrate application code that uses exstream.js for streaming ETL, backpressure, bounded asynchronous work, incremental CSV or JSON processing, branching, error policy, cancellation, destinations, Node or Web adapters, and API migrations including 1.0. Use when a request mentions Exstream or exstream.js, imports the package, or needs an Exstream pipeline. Do not use for generic JavaScript transformations that do not use Exstream or for changes to Exstream runtime internals.
---

# Exstream Pipelines

Build one connected, lazy data-flow graph whose memory, concurrency, delivery, failure, and cancellation behavior remain explicit.

## Workflow

1. Establish the contract before writing operators.
   - Identify the installed Exstream version; do not assume the checkout and published package match.
   - Identify runtime, source type, data volume, destination, required order, acceptable loss, error policy, and cancellation owner.
   - Choose the abstraction from the shape of the work and its marginal cost, not from input size alone.
   - Do not introduce Exstream solely for a trivial finite transformation. When Exstream is already a project-standard abstraction and the task is conceptually a source-to-terminal flow, prefer its uniform pipeline model even for small inputs when it improves separation, composition, or future evolution.
   - Keep native JavaScript for local collection manipulation when it is materially clearer.
2. Separate responsibilities before composing the graph.
   - Inspect the consuming project for existing schemas, validators, database abstractions, destination helpers, and error conventions before adding new ones.
   - Let source adapters own resource acquisition, transport concerns, and structural decoding such as CSV rows or JSON values.
   - Let transformation modules own pure validation, coercion, normalization, filtering, and domain mapping. Prefer the project's schema library over hand-written field-by-field parsing when it expresses the contract clearly.
   - Let destinations own batching, external writes, transactions, idempotency, destination-specific retries, and cleanup.
   - Let the application orchestrator compose the graph and own branching, cross-branch failure policy, cancellation, terminal execution, and coordinated completion.
   - Keep a trivial flow inline. Extract a boundary when it has independent dependencies, lifecycle, policy, reuse, or tests; do not create one file per operator mechanically.
3. Choose the source boundary.
   - Wrap an existing iterable, async iterable, Node readable, or Web `ReadableStream` with `exstream(source)`.
   - Use `exstream.defer(() => source)` when creating the source starts I/O or acquires a resource.
   - Use `exstream.fromEvent()` for hot event sources and choose a finite buffer and overflow policy.
   - Use `{ start: 'manual' }` only when reliable forks must be registered across asynchronous setup; attach them before `start()`.
4. Build a lazy transformation chain.
   - Keep ordinary `map()`, `filter()`, and reducers synchronous.
   - Use `mapAsync()` for independent per-record asynchronous work. Set a deliberate finite `concurrency`, choose `ordered`, and pass `context.signal` to cancellable I/O.
   - Use incremental CSV, JSON Lines, or forward-only JSON selection for large inputs. Set structural limits for untrusted input.
   - Use `pipeline()` for a fixed reusable chain and an operator function plus `through()` for parameterized composition.
   - Leave terminal consumption to the caller of a reusable transformation.
5. Define failure and delivery policy.
   - Treat per-record failures as record errors until a downstream policy replaces, drops, routes, or promotes them.
   - Handle recoverable records with `errors()`, `skipErrors()`, or `routeErrors()`; use `failOnError()` when one bad record invalidates the job.
   - Use `fork()` when every record must arrive. Use bounded `observe()` only when loss is acceptable and the main flow must not wait.
6. End every running branch with an authoritative terminal.
   - Use `for await`, `pipeTo()`, `drain()`, `toArray()`, or `single()` according to the required result.
   - Await every terminal promise. Do not infer success from an `end` event.
   - Coordinate multiple branch promises explicitly; a failed destination cancels its branch, not automatically every sibling.
7. Verify the operational contract.
   - Check that concurrency and every hot or observer buffer are bounded intentionally.
   - Check ordering, error, cancellation, cleanup, and early-termination behavior.
   - Run the consuming project's relevant tests and type checks. For examples in the Exstream repository, follow its package scripts and current declarations.

## Guardrails

- Do not start one promise per input or collect a large stream merely to perform asynchronous mapping.
- Do not use `mapAsync()` for an accumulator whose next step depends on the previous result; express that dependency with sequential async iteration at the consumption boundary.
- Do not introduce a large buffer to hide a pressure mismatch.
- Do not use `collect()`, `toArray()`, `sort()`, `groupBy()`, or `keyBy()` on large or unbounded input without explicitly accepting whole-input memory.
- Do not treat `start()` as a consumer or completion promise; it only authorizes a manual graph to activate.
- Do not call `pipeTo()`, `toArray()`, or another terminal inside a reusable operator function.
- Do not combine pure record validation with destination I/O in one callback when they have different dependencies, error policies, or useful independent tests.
- Do not assume returning an `Error` throws it. Thrown errors and rejected promises enter the error protocol; wrap an `Error` with `exstream.data()` when it is ordinary data.
- Do not silently drop record errors. Make replacement, loss, dead-letter routing, or fail-fast behavior visible in code.
- Do not force local, non-streaming collection expressions into Exstream solely for syntactic uniformity.
- Preserve context semantics: context is copied at branch boundaries, while record values retain ordinary JavaScript reference semantics.
- Prefer named options over positional or removed legacy APIs.

## Load Detailed Guidance

Read [references/semantics.md](references/semantics.md) when choosing among sources, asynchronous operators, aggregation, branching, error handlers, terminals, reusable composition, or runtime adapters.

When migrating existing code, also read the target version's migration guide. In this repository, use `MIGRATION.md`; verify public signatures against `types/index.d.ts` and behavior against tests instead of treating examples as stronger than code.

## Review Output

When reviewing or proposing a pipeline, state the relevant operational choices: source acquisition, boundedness, concurrency, ordering, buffering, delivery guarantee, record-error policy, cancellation, terminal completion, and runtime. Mention only the choices that materially affect the requested pipeline.