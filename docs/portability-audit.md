# Portable runtime architecture

Exstream 0.30 separates the shared pipeline engine from Node.js and browser
integration. The core has no third-party runtime dependencies and does not
install global polyfills.

## Runtime boundaries

| Area       | Shared core                                           | Node adapter                                 | Web adapter                                  |
| ---------- | ----------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| Events     | `EventHub` lifecycle facade                           | Native `EventEmitter` base for compatibility | Platform-neutral event base                  |
| Sources    | Iterable, async iterable, Promise, Exstream generator | Node `Readable` and `Readable.from()`        | `ReadableStream`, fetch body, `EventTarget`  |
| Sinks      | Exstream consumers and async iterator                 | Node writable streams and `Transform`        | `WritableStream` and `toWebReadable()`       |
| Bytes      | Byte operations through the runtime interface         | `Buffer` and `StringDecoder`                 | `Uint8Array`, `TextEncoder`, `TextDecoder`   |
| Scheduling | Internal microtask and next-turn operations           | Historical `setImmediate` next turn          | Timer fallback when `setImmediate` is absent |

`src/runtime.js` defines the portable contract. `src/node-runtime.js` installs
Node-specific operations; `src/web-runtime.js` selects the Web implementation.
Conditional package exports choose `src/index.js` in Node and `src/browser.js`
for browser-aware bundlers. Explicit `exstream.js/node` and `exstream.js/web`
entry points are also published.

## Node compatibility

The Node entry preserves the historical public shape: Exstream instances still
inherit from `EventEmitter`, accept Node readable streams, pipe into Node
writable streams, and expose `toNodeStream()`. Native `finished()` watches
writable destinations with listener cleanup. Record errors remain distinct from
fatal stream failures, so native `pipeline()` is not used to reinterpret them.

All direct imports of `events`, `stream`, `string_decoder`, uses of `Buffer`, and
checks for `process.stdout` are confined to `src/node-runtime.js`. The browser
bundle build fails if a Node built-in reaches its dependency graph.

## Web Streams

`ReadableStream` sources are pulled only when the Exstream consumer requests the
next record. Destruction cancels the reader and releases its lock.
`toWebReadable()` exposes the inverse pull boundary and maps reader cancellation
back to branch destruction or abort.

`pipe(WritableStream)` waits for `writer.ready` and each `writer.write()` before
requesting another record. Completion closes the sink by default; failures and
signals abort the graph and destination unless `preventClose` or `preventAbort`
selects owner-managed lifecycle. Reliable forks therefore inherit the
backpressure of the slowest Web sink.

Fetch response bodies need no special wrapper because they implement
`ReadableStream`. The browser integration suite exercises
`Response.body -> CSV -> transform -> WritableStream` directly.

## Event sources

`fromEvent()` accepts EventEmitter-like sources and `EventTarget`, with separate
data, end, and error events. Listener removal is tied to the Exstream lifecycle
and external `AbortSignal` cancellation.

Pausable producers use `pause()` when their bounded ingress buffer fills and
`resume()` on drain. Non-pausable hot sources must use a finite
`highWaterMark`; overflow is explicit as `error`, `drop-oldest`, or
`drop-newest`. Sources expose `received`, `buffered`, `peakBuffered`, and
`dropped` metrics.

## Byte-oriented operators

CSV, base64, `encode`, `decode`, and `split` use runtime byte and text codecs.
The Web path produces `Uint8Array` and supports streaming UTF-8 decode,
including multi-byte CSV separators split across chunks. Buffer conversion and
Node-specific encodings stay in the Node adapter.

## Verification

The Node suite covers lifecycle, error protocol, cancellation, context,
backpressure, fan-out, Web Stream adapters, event buffering, codecs, and the
portable async-iterable fallback. A separate Vite build is executed in Chrome
headless in both the main thread and a Web Worker. It also rejects Node built-in
imports before the bundle can be emitted.