# Migrating to 1.0

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

Calling instance-only methods such as `toNodeReadable()`, `toArray()`, `fork()`,
or `merge()` on a pipeline definition now fails immediately. Custom methods
added with `extend()` remain pipeline operators unless registered with
`{ pipeline: false }`.

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