# TypeScript and module migration

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
`toNodeStream()` is unavailable there.

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
such as calling `resolve()` on non-promise values or reading a field removed by
`omit()`. These are compile-time diagnostics only; they do not add runtime checks
or change error handling.