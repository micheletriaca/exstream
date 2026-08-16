# Exstream

[![test](https://github.com/micheletriaca/exstream/actions/workflows/main.yaml/badge.svg)](https://github.com/micheletriaca/exstream/actions/workflows/main.yaml)
[![Coverage Status](https://coveralls.io/repos/github/micheletriaca/exstream/badge.svg?branch=master)](https://coveralls.io/github/micheletriaca/exstream?branch=master)
[![npm](https://img.shields.io/npm/v/exstream.js.svg)](https://www.npmjs.com/package/exstream.js)

**Composable streaming ETL for JavaScript.**

Exstream connects data sources, synchronous and asynchronous transformations,
and one or more destinations into a single backpressured pipeline. It is built
for jobs where records may number in the millions, I/O must run concurrently
without running wild, and the complete graph must stop cleanly when something
fails or is cancelled.

```shell
npm install exstream.js
```

Exstream requires Node.js 22 or newer. It has no runtime dependencies and ships
with TypeScript declarations, CommonJS and ESM entry points, and a portable core
for modern browsers.

## A pipeline

```javascript
import exstream from 'exstream.js'

const orders = exstream(response.body)
  .json({ path: '$.data.orders[*]' })
  .mapAsync(
    async (order, context) => ({
      ...order,
      customer: await loadCustomer(order.customerId, {
        signal: context.signal,
      }),
    }),
    { concurrency: 16, ordered: true, retry: 2, timeout: 5_000 },
  )
  .filter((order) => order.customer.active)

for await (const order of orders.toAsyncIterator()) {
  await writeOrder(order)
}
```

Input is pulled only as fast as the slowest reliable consumer can accept it.
`mapAsync()` bounds active work and preserves order by default. The context
signal is cancelled when work for that record and branch is no longer useful.

## Why Exstream

- **End-to-end backpressure.** Pressure propagates through transforms, forks,
  merges, Node streams, Web Streams, iterables and async iterables.
- **Controlled asynchronous work.** Concurrency, ordering, retries, timeouts,
  throttling and cancellation are explicit rather than hidden in callbacks.
- **Real pipeline graphs.** Reusable pipelines, reliable `fork()` branches,
  best-effort `observe()` branches and ordered or unordered merges are built in.
- **Streaming data formats.** CSV, JSON Lines and a forward-only JSONPath subset
  process large inputs without first collecting the complete document.
- **Predictable failures.** Recoverable record errors and fatal graph failures
  have separate policies, cleanup and cancellation semantics.
- **Types that follow the data.** Value and record-context types evolve through
  chained operators, including asynchronous transformations.
- **A fast synchronous path.** Ordinary `map()` and `filter()` pipelines do not
  pay the cost of an asynchronous abstraction they are not using.

## Formats

CSV parsing and serialization support quoted and multiline fields, byte chunks,
custom multi-character Unicode separators, headers, size limits and located
errors:

```javascript
const rows = exstream(csvChunks).csv({
  header: true,
  maxColumns: 100,
  maxRecordBytes: 8 * 1024 * 1024,
})
```

JSON Lines is available through `jsonl()` and `jsonlStringify()`. `json()` can
select values from one large document as soon as they complete:

```javascript
const events = exstream(jsonChunks).json({
  path: '$.batches[*].events[*]',
  maxDepth: 100,
  maxValueBytes: 8 * 1024 * 1024,
})
```

`jsonStringify()` incrementally writes an array or object envelope. Its
end-of-stream finalizer can add properties computed while the records flow:

```javascript
const document = exstream(records).jsonStringify({
  path: '$.data.records[*]',
  properties: { version: 1 },
  finalize: ({ count }) => ({ count }),
})
```

The supported JSONPath subset is intentionally forward-only: property access,
non-negative array indexes and `[*]` wildcards. Recursive descent, filters,
slices and expressions require buffering or a different tool.

## Fan-out, errors and context

`fork()` is reliable: every branch participates in backpressure. `observe()` is
non-blocking and accepts an explicit buffer limit and overflow policy for work
such as metrics or sampling.

Errors produced while handling one record remain recoverable with `errors()`,
`skipErrors()` or `routeErrors()`. `failOnError()` promotes the first record
error to a fatal failure and cancels the connected graph.

Use `pipeTo()` when writing must be an explicit terminal operation:

```javascript
try {
  await exstream(input).csv({ header: true }).map(transform).jsonStringify().pipeTo(output)
} catch (error) {
  const { origin, stage } = exstream.errorInfo(error)
  console.error(`Pipeline failed in ${origin}:${stage ?? 'unknown'}`, error)
}
```

The promise resolves only after the destination finishes. It rejects on an
unhandled record error, source or destination failure, structural format error,
or cancellation. A failed destination cancels its own fork; reliable sibling
branches can continue. The older `pipe()` remains available for Node-compatible
event-driven piping.

Record context is opt-in. `withContext()` and `extendContext()` attach metadata
such as correlation IDs or loaded dependencies to one record. Context is copied
at branch boundaries, while record values retain normal JavaScript reference
semantics.

## Runtimes and imports

```javascript
import exstream from 'exstream.js' // selects Node.js or browser
import nodeExstream from 'exstream.js/node'
import portableExstream from 'exstream.js/core'
import webExstream from 'exstream.js/web'

const commonJsExstream = require('exstream.js')
```

The portable runtime works with Web Streams, `AbortController`, `EventTarget`,
`TextEncoder` and `TextDecoder`. The Node.js entry point also understands Node
streams, `Buffer` and Node-supported text encodings. Exstream does not install
global polyfills.

## When not to use it

For a small array that already fits in memory, native array methods or a simple
`for await` loop are usually clearer. Exstream earns its place when the problem
is the pipeline as a whole: bounded memory, concurrent I/O, fan-out,
backpressure, cancellation, format parsing and cleanup.

## Documentation

The full documentation portal is the next roadmap step and will live at
[exstream-js.github.io](https://exstream-js.github.io/). Until then, the
repository contains the [migration guide](MIGRATION.md),
[support policy](SUPPORT.md), [changelog](CHANGELOG.md) and reproducible
[benchmark methodology](test/benchmarks/README.md).

Exstream is released under the [MIT License](LICENSE).