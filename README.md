# Exstream

![test](https://github.com/micheletriaca/exstream/actions/workflows/main.yaml/badge.svg)
[![Coverage Status](https://coveralls.io/repos/github/micheletriaca/exstream/badge.svg?branch=master)](https://coveralls.io/github/micheletriaca/exstream?branch=master)

```shell
yarn add exstream.js

# or

npm install exstream.js
```

Exstream requires Node.js 22 or newer.

## How to use it

Here is a sync example:

```javascript
const exs = require('exstream.js')

const res = exs([1, 2, 3])
  .reduce((memo, x) => memo + x, 0)
  .value()

// res is 6
```

## Lifecycle, fan-out, and buffering

Streams expose an explicit `state` (`idle`, `running`, `ending`, `ended`,
`aborted`, or `destroyed`). `start()`, `end()`, `destroy()`, and `abort()` are
idempotent; `abortReason` retains the first abort reason.

`fork()` is reliable fan-out: every fork participates in backpressure.
`observe()` never slows the main flow, so a slow observer may need an explicit
bounded best-effort policy:

```javascript
const source = exs(rows)
const audit = source.observe({ bufferLimit: 1000, overflow: 'drop-oldest' })

console.log(audit.buffered, audit.peakBuffered, audit.dropped)
```

The same `{ bufferLimit, overflow }` options can be passed as the second
argument to `exs()`. The default limit is `Infinity` and the default overflow
policy is `error`. `drop-oldest` and `drop-newest` require a finite limit.

## Data and error records

For compatibility, `stream.write(error)` and `push(error)` create an error
record. The second argument of `push` is always data, so `push(null, error)`
passes an `Error` object through the pipeline as an ordinary value.

Use `exs.data(value)` to mark a value in an iterable source explicitly, or
`stream.writeData(value)` when writing manually:

```javascript
const errorAsData = exs([exs.data(new Error('business value'))])
const writable = exs()

writable.writeData(new Error('another business value'))
writable.end()
```

Record errors remain recoverable through `.errors()`. Use
`stream.fail(reason, input)` for an unrecoverable stream failure: it bypasses
record-error handlers, rejects Promise sinks, and aborts every connected fork
and observer with the normalized error as `abortReason`.

## Record context and cancellation

Context is opt-in and belongs to a record as it moves through a branch. Use
`withContext()` to establish it and `extendContext()` for asynchronous
enrichment:

```javascript
const enriched = exs(rows)
  .withContext((row) => ({ correlationId: row.id }))
  .extendContext(async (row, context) => ({
    customer: await loadCustomer(row.customerId, { signal: context.signal }),
  }))
  .map((row, context) => ({
    correlationId: context.correlationId,
    customer: context.customer,
    row,
  }))
```

The initializer may return an object or mutate the context directly. `input`
is the value for which the context was established, while `signal` is managed
by Exstream and is cancelled when that branch is aborted, destroyed, or fails.
An external signal can cancel a source with `exs(source, { signal })`.

Existing unary callbacks keep their historical argument list. Declare a
second parameter to opt into context in `map`, `filter`, `reject`,
`asyncFilter`, and `tap`; similarly, reducers receive it as their third
parameter. Because callback arity is used for compatibility, a defaulted
second parameter does not opt in.

One-to-one operators preserve the same mutable context. `fork()` and
`observe()` make shallow branch-local copies. `flatten()` makes one shallow
copy per emitted child. Fan-in operators such as `batch()`, `collect()`, and
the reducers create an aggregate context whose `input` is the aggregate value
and whose `contexts` array is aligned with the contributing records.
Concurrent `resolve()` and both ordered and unordered `merge()` retain each
record's context.

Look at the [documentation](https://exstream-js.github.io/) or
see more examples in the [test folder](./test).