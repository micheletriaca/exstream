# Migrating to 1.0

## Operators

Operators are no longer exported as standalone or curried functions. Call them
on a live Exstream or record them on a reusable pipeline:

```js
// Before
const parseOrders = exstream.jsonl({ path: '$.orders[*]' })
const orders = source.through(parseOrders)

// 1.0: direct chain
const orders = source.jsonl({ path: '$.orders[*]' })

// 1.0: reusable definition
const parseOrders = exstream.pipeline().jsonl({ path: '$.orders[*]' })
const orders = source.through(parseOrders)
```

Top-level factories and utilities remain available: `pipeline()`, `defer()`,
`destination()`, `fromEvent()`, `data()`, `errorInfo()`, `nil`, and the public
error classes.

`reduce1()` was folded into `reduce()`:

```js
// Before
stream.reduce1((total, value) => total + value)

// 1.0
stream.reduce((total, value) => total + value)
```

Without an explicit initial value, the first successful record becomes the
accumulator and an empty input emits no result. Passing an initial value keeps
the existing behavior, including emitting that value for empty input.

`sort()` now accepts the comparison function previously passed to `sortBy()`:

```js
// Before
stream.sortBy((left, right) => right.score - left.score)

// 1.0
stream.sort((left, right) => right.score - left.score)
```

`map()` no longer has a special wrapping mode. Build the output shape in the
callback:

```js
// Before
stream.map(calculateScore, { wrap: true })

// 1.0
stream.map((input) => ({ input, output: calculateScore(input) }))
```

`through()` now has one job: compose a reusable pipeline, transform function,
or Node transform into the current flow. Use an empty pipeline when a
conditional transform should do nothing; this is an optimized identity and
does not add a stream node:

```js
// Before
source.through(enabled ? normalize : null)

// 1.0
source.through(enabled ? normalize : exstream.pipeline())
```

Live Exstreams are sources rather than transform definitions, and Node writers
are terminal destinations:

```js
// Before
source.through(exstream().map(normalize))
source.through(writer, { writable: true })

// 1.0
source.through(exstream.pipeline().map(normalize))
await source.pipeTo(writer)
```

## Terminal operations

Terminal methods now have one predictable contract: methods that represent
completion return a promise, regardless of whether every upstream stage happens
to be synchronous.

| Before                                                         | 1.0                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `toPromise()`, `values()`, `valuesSync()`, `toArray(callback)` | `await toArray()`                                                   |
| `value()`                                                      | `await single()`                                                    |
| `toAsyncIterator()`                                            | iterate the stream directly with `for await`                        |
| `toNodeStream()`                                               | `toNodeReadable()`                                                  |
| `pipe(destination)`                                            | `await pipeTo(destination)`                                         |
| `each(callback)`                                               | `tap(callback).drain()`                                             |
| repeated `pull()` calls                                        | use the async iterator returned by `stream[Symbol.asyncIterator]()` |
| `resolve(concurrency, ordered)`                                | `mapAsync((value) => value, { concurrency, ordered })`              |
| `massThen(fn)`                                                 | perform the asynchronous transformation in `mapAsync(fn)`           |
| `massCatch(fn)`                                                | catch inside `mapAsync()` or handle the resulting stream error      |

On an Exstream instance, `drain()` and `pipeTo()` remain and return
`Promise<void>`.
`toWebReadable()` remains the Web Streams adapter. Terminal methods are
instance-only; their standalone and curried exports were removed. A pipeline
definition may now use `drain()` to create a reusable `Destination`:

```js
const writer = exstream.pipeline().batch(200).mapAsync(postBatch).drain()
await exstream(rows).pipeTo(writer)
```

A source-backed Exstream still uses `toNodeReadable()`. A reusable pipeline has
no source to expose, so use `toNodeTransform()` when a Node API expects a native
transform:

```js
const normalize = exstream.pipeline().map(normalizeOrder)
await nodePipeline(input, normalize.toNodeTransform(), output)
```

`asyncFilter()` and `asyncReduce()` were removed. When asynchronous work is
independent per record, run it through `mapAsync()` and keep selection or
aggregation synchronous:

```js
const total = await exstream(orderIds)
  .mapAsync(loadOrder, { concurrency: 8 })
  .filter((order) => order.status === 'paid')
  .reduce((sum, order) => sum + order.total, 0)
  .single()
```

When every asynchronous accumulator step depends on the previous result, make
that sequencing explicit at the consumption boundary:

```js
let digest = initialDigest
for await (const chunk of stream) {
  digest = await extendDigest(digest, chunk)
}
```

Calling instance-only methods such as `toNodeReadable()`, `toArray()`, `fork()`,
or `merge()` on a pipeline definition now fails immediately. Custom methods
are no longer installed globally with `extend()`. Define an ordinary transform
function and attach it with `through()`; reusable pipelines can record the same
functional operator:

```js
const multiply = (factor) => (stream) => stream.map((value) => value * factor)

const reusable = exstream.pipeline().through(multiply(2))
const values = await exstream([1, 2, 3]).through(reusable).toArray()
```

```js
const rows = await exstream(source).map(normalize).toArray()
const total = await exstream(source)
  .reduce((sum, row) => sum + row.amount, 0)
  .single()

for await (const row of exstream(source).map(normalize)) {
  await writeRow(row)
}
```

`single()` resolves to `undefined` for an empty stream and rejects if a second
value is produced. It consumes through the end to enforce that cardinality.

## Lifecycle and manual sources

Backpressure and graph shutdown controls are no longer exposed on every stream
instance. `pause()`, `resume()`, `fail()`, `destroy()`, and `abort()` were
internal state-machine operations whose behavior depended on where a stream sat
inside its graph. Use terminal demand for normal execution and pass an
`AbortSignal` when work must be cancelled externally:

```js
const controller = new AbortController()
const completion = exstream(source, { signal: controller.signal }).pipeTo(destination)

controller.abort(new Error('job cancelled'))
await completion
```

Manual writable sources still use `write()` and `end()`. `writeData()` was
removed because `write(data(value))` already expresses the same operation,
including when the value is an `Error`:

```js
const source = exstream()
source.write(1)
source.write(exstream.data(new Error('ordinary value')))
source.end()
```

`consume()` and `consumeSync()` remain the low-level extension points for
building custom operators.

The `fork(true)` boolean was removed. Configure manual activation on the source,
attach reliable forks in as many turns as needed, and close the graph-building
phase with `start()`:

```js
const source = exstream(input, { start: 'manual' })
const first = source.fork().pipeTo(firstDestination)

await discoverSecondDestination()
const second = source.fork().pipeTo(secondDestination)

await source.start()
await Promise.all([first, second])
```

`start()` is idempotent and may be called on a transformed branch; activation
belongs to the root source graph. It supplies no demand and does not wait for
completion.

Source adapters now acquire iterators and platform readers on demand. When even
creating the source must be delayed, use `defer(() => source)`. This distinction
matters for calls such as `fetch()` and `createReadStream()`, which have already
started or acquired resources if their result is passed directly.

## Merging deferred sources

`merge()` now accepts only Exstream instances. Replace merge-specific stream
factories with deferred inner sources:

```js
// Before
exstream(paths)
  .map((path) => () => exstream(createReadStream(path)).jsonl())
  .merge(4)

// 1.0
exstream(paths)
  .map((path) => exstream.defer(() => createReadStream(path)).jsonl())
  .merge({ concurrency: 4 })
```

The `defer()` factory runs only when `merge()` activates that inner stream, so
the merge concurrency still limits the number of open resources. Unlike the
removed merge-specific factory, `defer()` also accepts asynchronous acquisition
and every supported source type.

Ordering and concurrency now use named options:

```js
// Before
exstream(streams).merge(4, true)

// 1.0
exstream(streams).merge({ concurrency: 4, ordered: true })
```

## Joining sorted streams

`sortedJoin()` is now called directly on the left input. Join configuration is
named, and results use `left` and `right` instead of `a` and `b`:

```js
// Before
const joined = exstream([customers, orders]).sortedJoin('id', 'customerId', 'left', 'asc', 100)

// 1.0
const joined = customers.sortedJoin(orders, {
  leftKey: 'id',
  rightKey: 'customerId',
  type: 'left',
  order: 'asc',
})
```

The removed `buffer` parameter only changed internal read granularity. The new
implementation follows downstream demand directly. A custom `order` function
is now a standard numeric comparator: negative means the left key comes first,
zero means the keys match, and positive means the right key comes first.

The standalone curried form was removed because a sorted join is specific to
two live stream instances and cannot be recorded in a reusable pipeline.

## Custom callback sources

The legacy `(write, next) => void` source protocol was removed. Use the language
iterator protocols for pull-based sources:

```js
// Before
let value = 0
const source = exstream((write, next) => {
  if (value === 10) write(exstream.nil)
  else {
    write(value++)
    next()
  }
})

// 1.0
function* values() {
  for (let value = 0; value < 10; value++) yield value
}
const source = exstream(values())
```

Use an async generator when acquiring a record is asynchronous. Exceptions,
completion and cleanup then follow standard `throw`, `return`, and `finally`
semantics:

```js
async function* rows() {
  const cursor = await openCursor()
  try {
    while (true) {
      const item = await cursor.read()
      if (item.done) return
      yield item.value
    }
  } finally {
    await cursor.close()
  }
}
```

Replace `next(otherSource)` with `yield* otherIterable`. For genuinely push-based
adapters, create a writable source with `exstream()`, respect the boolean result
of `write()`, and terminate it with `end()`; event targets should normally use
`fromEvent()`.

Generic helpers and internal type guards previously copied onto the package
export are no longer public. Applications should use JavaScript and platform
primitives directly; for example, use `typeof value === 'string'`,
`Object.hasOwn()`, and native function composition.

## TypeScript and module migration in 0.33

The 0.33 package keeps the existing CommonJS API and adds typed ESM, Node, core,
and browser entry points. The packaging changes do not alter runtime pipeline
behavior.

## Imports

Existing CommonJS code continues to work:

```js
const exstream = require('exstream.js')
```

ES modules may use either the default export or named utilities:

```js
import exstream, { nil, pipeline } from 'exstream.js'
```

Use an explicit entry point when the target runtime should not depend on package
conditions:

```js
import exstream from 'exstream.js/node'
import portableExstream from 'exstream.js/core'
import webExstream from 'exstream.js/web'
```

`core` and `web` select the portable runtime. Node-only conversion such as
`toNodeReadable()` and `toNodeTransform()` are unavailable there.

## Value inference

Every transformation returns a stream with its inferred output value type:

```ts
const amounts = exstream([{ amount: 10 }])
  .map((row) => Object.assign(row, { valid: true as const }))
  .map((row) => (row.valid ? row.amount : 0))
```

TypeScript cannot widen an existing object type after direct mutation. Returning
`Object.assign(row, additions)` or a new object makes added fields visible to the
next operator. Exstream does not clone values automatically; existing mutation
and fork-reference behavior is unchanged.

## Record context inference

`withContext()` and `extendContext()` add their returned fields to the context
type used by later callbacks:

```ts
const rows = exstream(source)
  .withContext((row) => ({ correlationId: row.id }))
  .extendContext(async (_row, context) => ({
    request: await loadRequest(context.correlationId, { signal: context.signal }),
  }))
  .map((row, context) => ({ row, request: context.request }))
```

The context is still created lazily at runtime. Declaring a context parameter in
a callback opts into it exactly as before.

## Stricter feedback

The declarations expose invalid assumptions that JavaScript previously allowed,
such as reading a field removed by `omit()`. These are compile-time diagnostics
only; they do not add runtime checks or change error handling.