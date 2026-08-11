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

Look at the [documentation](https://exstream-js.github.io/) or
see more examples in the [test folder](./test).