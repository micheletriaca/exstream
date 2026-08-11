# Core portability audit

This audit records the Node.js coupling that exists in Exstream 0.26. It does
not claim browser compatibility. Its purpose is to define extraction boundaries
for the portable core planned for 0.30 without changing the 0.26 public API.

## Runtime dependencies

Exstream has no third-party runtime dependencies. Its environment coupling is
entirely through Node.js globals and built-in modules.

| Area           | Current locations                                   | Coupling                                                                   | Proposed boundary                                                                           |
| -------------- | --------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Events         | `src/exstream.js`                                   | `Exstream` extends Node `EventEmitter`                                     | Internal lifecycle/events interface with Node and EventTarget adapters                      |
| Node streams   | `src/exstream.js`, `src/methods.js`, `src/utils.js` | `Readable`, `Transform`, duck-typed source detection, `pipe` and `through` | Explicit Node readable/writable adapter and a protocol-based core source/sink               |
| Scheduling     | `src/scheduler.js`                                  | Node uses `setImmediate` for next-turn compatibility                       | Internal microtask and next-turn operations with a browser timer fallback                   |
| Monotonic time | `src/scheduler.js`                                  | None beyond the standard Performance API                                   | Internal clock backed by `performance.now()`                                                |
| Bytes and text | `src/csv.js`, `src/methods.js`                      | CSV, base64 and encoding use `Buffer` and `StringDecoder`                  | `Uint8Array`, `TextEncoder` and `TextDecoder` byte layer; Buffer conversion in Node adapter |

## Findings

### Lifecycle and events

`src/exstream.js` mixes the stream state machine with EventEmitter inheritance.
Listener cleanup is characterized by `test/cleanup-invariants.test.js`, so a
future event facade must preserve those end, error, drain, finish and close
semantics before the inheritance can be removed.

### Scheduler

Startup, end propagation, generator resumption, piping and destruction now use
the internal scheduler. Microtask and next-turn behavior remain distinct and
are covered by ordering tests. Node keeps its historical `setImmediate`
next-turn behavior, while environments without it use `setTimeout(0)`.

### Stream adapters

The constructor accepts Node readable streams and async iterables, while `pipe`,
`through` and `toNodeStream` contain writable/transform integration. Iterable,
async iterable and promise sources are the natural portable protocol. Node and
Web Stream support should adapt to that protocol at the package boundary.

### Byte-oriented operators

CSV parsing currently relies on Buffer indexing, slicing, concatenation and
encoding-aware conversion. `encode`, `decode`, `split` and `splitBy` also use
Buffer or StringDecoder. These operators should move onto a shared Uint8Array
and text-codec layer before a browser entry point is published. The existing
CSV chunk-boundary and multibyte-separator tests define part of that contract.

### Timing operators

`ratelimit` and `makeAsync` now use the scheduler's `performance.now()` clock.
Wall-clock `Date` behavior in `throttle` remains separate and must be
characterized before unification.

## 0.30 extraction order

1. Separate Node readable/writable detection and piping from `Exstream`.
2. Replace internal Buffer assumptions with Uint8Array and codec helpers.
3. Replace EventEmitter inheritance with an internal event facade.
4. Add Web Streams and EventTarget adapters and run the shared transformation
   suite in a browser and a Web Worker.

Until those steps are complete, the package must continue to advertise Node.js
as its supported runtime.