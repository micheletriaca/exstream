import exstream = require('exstream.js')

// @ts-expect-error Global prototype extension is not part of the public API.
void exstream.extend

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type Value<S> = S extends exstream.Exstream<infer T, any> ? T : never
type Context<S> = S extends exstream.Exstream<any, infer C> ? C : never

const enriched = exstream([{ a: 1 }])
  .map((value) => Object.assign(value, { b: 2 }))
  .map((value) => value.a + value.b)

type EnrichedValue = Expect<Equal<Value<typeof enriched>, number>>

const enrichedObject = exstream([{ a: 1 }]).map((value) => Object.assign(value, { b: 2 }))
type EnrichedObject = Expect<Equal<Value<typeof enrichedObject>, { a: number } & { b: number }>>

exstream([{ a: 1 }])
  .map((value) => String(value.a))
  .map((value, lazyContext) => {
    const currentInput: string = lazyContext.input
    return currentInput.length + value.length
  })

const contextual = exstream([{ id: 'a' }])
  .withContext((value) => ({ correlationId: value.id }))
  .extendContext(async (_value, context) => ({ requestId: context.correlationId.length }))
  .map((value, context) => ({
    id: value.id,
    correlationId: context.correlationId,
    requestId: context.requestId,
    originalId: context.input.id,
    aborted: context.signal.aborted,
  }))

type ContextFields = Context<typeof contextual>
declare const context: ContextFields
const correlationId: string = context.correlationId
const requestId: number = context.requestId

const narrowed = exstream<string | number>(['one', 2]).filter(
  (value): value is string => typeof value === 'string',
)
type NarrowedValue = Expect<Equal<Value<typeof narrowed>, string>>

const errorData = exstream([exstream.data(new Error('business value'))])
const typedErrorData: exstream.Exstream<Error, exstream.LazyRecordContext<Error>> = errorData
type ErrorDataValue = Value<typeof errorData>

const batched = exstream([1, 2, 3]).batch(2)
type BatchValue = Expect<Equal<Value<typeof batched>, number[]>>
declare const batchContext: Context<typeof batched>
const batchInput: number[] = batchContext.input

const customers = exstream([{ id: 1, name: 'Ada' }])
const orders = exstream([{ customerId: 1, total: 42 }])
const uniqueCustomers = customers.uniq('id')
customers.uniq(['id', 'name'])
customers.uniq((customer, customerContext) => customer.id + customerContext.input.id)
exstream([1, 2]).uniq()
exstream([1, 2]).uniq((value) => value % 2)
type UniqueCustomer = Expect<Equal<Value<typeof uniqueCustomers>, { id: number; name: string }>>
// @ts-expect-error uniqBy() was folded into uniq(selector).
customers.uniqBy('id')
// @ts-expect-error Unknown fields are rejected by the property-selector overload.
customers.uniq('missing')

customers.rateLimit({ limit: 100, interval: 60_000 })
exstream.pipeline<number>().rateLimit({ limit: 2, interval: 1000 })
// @ts-expect-error ratelimit() was renamed to rateLimit().
customers.ratelimit(100, 60_000)
// @ts-expect-error rateLimit() uses named options.
customers.rateLimit(100, 60_000)
exstream(['one\ntwo']).split()
exstream(['one\ntwo']).split('utf8')
exstream(['one\0two']).split(/\0/, 'utf8')
exstream.pipeline<Uint8Array>().split(/\0/)
// @ts-expect-error splitBy() was folded into split(separator, encoding).
exstream(['one\0two']).splitBy(/\0/)
const innerJoin = customers.sortedJoin(orders, {
  leftKey: 'id',
  order: (customerId, orderCustomerId) => customerId - orderCustomerId,
  rightKey: 'customerId',
})
type InnerJoinValue = Expect<
  Equal<
    Value<typeof innerJoin>,
    {
      key: number
      left: { id: number; name: string }
      right: { customerId: number; total: number }
    }
  >
>

const leftJoin = exstream([{ id: 1 }]).sortedJoin(exstream([{ ownerId: 1 }]), {
  leftKey: (value, recordContext) => value.id + recordContext.input.id - value.id,
  rightKey: (value, recordContext) => value.ownerId + recordContext.input.ownerId - value.ownerId,
  type: 'left',
})
type LeftJoinValue = Expect<
  Equal<
    Value<typeof leftJoin>,
    { key: number; left: { id: number }; right: { ownerId: number } | null }
  >
>

// @ts-expect-error sortedJoin is a graph operation, not a standalone curried operator.
void exstream.sortedJoin

const reducedWithContext = exstream([1, 2]).reduce((sum, value, recordContext) => {
  const original: number = recordContext.input
  return sum + value + original
}, 0)
declare const reducedContext: Context<typeof reducedWithContext>
const contributingContext: exstream.RecordContext<unknown> | undefined =
  reducedContext.contexts?.[0]

const reducedWithoutInitial = exstream([{ total: 1 }, { total: 2 }]).reduce((sum, value) => ({
  total: sum.total + value.total,
}))
type ReducedWithoutInitial = Expect<Equal<Value<typeof reducedWithoutInitial>, { total: number }>>

const mappedPromise = exstream([1]).map(async (value) => String(value))
type MappedPromiseValue = Expect<Equal<Value<typeof mappedPromise>, Promise<string>>>
// @ts-expect-error map() no longer has a wrapping options argument.
exstream([1]).map(String, { wrap: true })

const csvObjects = exstream(['id,name\n1,Ada\n']).csv({ header: true })
type CsvObject = Expect<Equal<Value<typeof csvObjects>, Record<string, string>>>

const csvArrays = exstream(['1,Ada\n']).csv()
type CsvArray = Expect<Equal<Value<typeof csvArrays>, string[]>>

interface JsonRow {
  id: number
  name: string
}

const jsonRows = exstream(['{"rows":[{"id":1,"name":"Ada"}]}']).json<JsonRow>({
  path: '$.rows[*]',
})
type JsonRowValue = Expect<Equal<Value<typeof jsonRows>, JsonRow>>

const unknownJson = exstream(['null']).json()
type UnknownJsonValue = Expect<Equal<Value<typeof unknownJson>, unknown>>

const jsonlRows = exstream(['{"id":1,"name":"Ada"}\n']).jsonl<JsonRow>()
type JsonlRowValue = Expect<Equal<Value<typeof jsonlRows>, JsonRow>>

const jsonOutput = exstream([{ id: 1 }]).jsonStringify({
  path: '$.rows[*]',
  finalize: async ({ bytesWritten, count, signal }) => ({
    bytesWritten,
    count,
    stopped: signal.aborted,
  }),
})
type JsonOutputValue = Expect<Equal<Value<typeof jsonOutput>, string | Uint8Array>>

const jsonlOutput = exstream([{ id: 1 }]).jsonlStringify()
type JsonlOutputValue = Expect<Equal<Value<typeof jsonlOutput>, string | Uint8Array>>

// @ts-expect-error Operators are available only on streams and reusable pipelines.
void exstream.map
// @ts-expect-error Format operators are not standalone exports.
void exstream.json

const reusable = exstream
  .pipeline<number>()
  .map((value) => ({ value }))
  .withContext((row) => ({ sourceValue: row.value }))
  .map((row, rowContext) => row.value + rowContext.sourceValue)

const throughPipeline = exstream([1, 2]).through(reusable)
type PipelineValue = Expect<Equal<Value<typeof throughPipeline>, number>>

const aggregatedPipeline = exstream
  .pipeline<{ id: string; amount: number }>()
  .filter((row) => row.amount > 0)
  .map((row) => Object.assign(row, { valid: true as const }))
  .batch(10)
  .map((rows) => rows.map((row) => row.valid))
const aggregated = exstream([{ id: 'a', amount: 1 }]).through(aggregatedPipeline)
type AggregatedPipelineValue = Expect<Equal<Value<typeof aggregated>, true[]>>

const nestedPipeline = exstream
  .pipeline<number>()
  .map((value) => String(value))
  .through(exstream.pipeline<string>().map((value) => value.length))
const nestedResult = exstream([1]).through(nestedPipeline)
type NestedPipelineValue = Expect<Equal<Value<typeof nestedResult>, number>>

const contextualFork = contextual.fork()
type ForkValue = Expect<Equal<Value<typeof contextualFork>, Value<typeof contextual>>>
type ForkContext = Expect<Equal<Context<typeof contextualFork>, Context<typeof contextual>>>

const merged = exstream([exstream([1]), exstream([2])]).merge({
  concurrency: 2,
  ordered: true,
})
type MergedValue = Expect<Equal<Value<typeof merged>, number>>

const deferredMerged = exstream([exstream.defer(() => [1]), exstream.defer(() => ['two'])]).merge({
  concurrency: 2,
  ordered: true,
})
export type DeferredMergedValue = Expect<Equal<Value<typeof deferredMerged>, number | string>>

// @ts-expect-error merge() consumes a stream of Exstreams.
exstream([1, 2]).merge()
// @ts-expect-error Positional merge arguments were replaced by named options.
exstream([exstream([1])]).merge(1, true)
// @ts-expect-error Lazy acquisition belongs in defer(), not in merge() inputs.
exstream([() => exstream([1])]).merge()

const routed = exstream([{ id: 1 }]).routeErrors()
type RoutedOutput = Expect<Equal<Value<typeof routed.output>, { id: number }>>
type DeadLetter = Expect<
  Equal<
    Value<typeof routed.deadLetters>,
    { error: exstream.ExstreamError<{ id: number }>; input: { id: number } }
  >
>

const webReadable: ReadableStream<number> = exstream([1]).toWebReadable()
const asyncIterator: AsyncIterableIterator<number> = exstream([1])[Symbol.asyncIterator]()
const pipeDestination: exstream.NodeWritableLike<number> = {} as exstream.NodeWritableLike<number>
const pipeCompletion: Promise<void> = exstream([1]).pipeTo(pipeDestination)
const batchDestination = exstream
  .pipeline<number>()
  .batch(200)
  .mapAsync(async (batch) => {
    const values: number[] = batch
    void values
  })
  .drain()
const destinationCompletion: Promise<void> = exstream([1, 2]).pipeTo(batchDestination)
const recoveredAsync = exstream([{ id: 1 }]).mapAsync(async (input) => String(input.id), {
  onFail(error, input, push, attempt, retry, context) {
    const failedInput: { id: number } = error.exstreamInput
    const currentInput: { id: number } = input
    const attemptNumber: number = attempt
    const signal: AbortSignal = context.signal
    retry()
    retry({ id: input.id + 1 })
    push(error, input)
    push(null, 'fallback')
    // @ts-expect-error retry() accepts another mapAsync input, not its output.
    retry('wrong input')
    // @ts-expect-error A successful recovery must emit the mapAsync output type.
    push(null, 123)
    void failedInput
    void currentInput
    void attemptNumber
    void signal
  },
})
type RecoveredAsyncValue = Expect<Equal<Value<typeof recoveredAsync>, string>>
const customDestination: exstream.Destination<number> = exstream.destination<number>(
  async (source, { signal }) => {
    const destinationSignal: AbortSignal = signal
    await source.map((value) => value * 2).drain()
    void destinationSignal
  },
)
const customDestinationCompletion: Promise<void> = exstream([1]).pipeTo(customDestination)
// @ts-expect-error This destination consumes numbers, not strings.
exstream(['one']).pipeTo(batchDestination)
const errorOrigin: exstream.ErrorOrigin = exstream.errorInfo(Error('failure')).origin
const nodeReadable: exstream.NodeReadableLike<number> = exstream([1]).toNodeReadable()
const nodeTransform: exstream.NodeTransformLike<number, string> = exstream
  .pipeline<number>()
  .map((value) => String(value))
  .toNodeTransform()
nodeTransform.write(1)
const transformedByNode = exstream([1]).through(nodeTransform)
type NodeThroughValue = Expect<Equal<Value<typeof transformedByNode>, string>>
// @ts-expect-error Use an empty pipeline as the explicit identity target.
exstream([1]).through(null)
// @ts-expect-error Live Exstreams are data sources, not reusable transformations.
exstream([1]).through(exstream<number>().map((value) => value * 2))
// @ts-expect-error Node writers are terminal destinations handled by pipeTo().
exstream([1]).through({ write() {}, end() {} }, { writable: true })
// @ts-expect-error A reusable pipeline has no source to expose as a Node readable.
exstream.pipeline<number>().toNodeReadable()
// @ts-expect-error Pipeline instances are created only by through().
exstream.pipeline<number>().generateStream()
// @ts-expect-error Recorded operator definitions are internal state.
void exstream.pipeline<number>().definitions
// @ts-expect-error An instantiated Exstream is readable, not a reusable Node transform definition.
exstream([1]).toNodeTransform()
// @ts-expect-error Asynchronous selection is expressed with mapAsync() followed by filter().
exstream([1]).asyncFilter(async (value) => value > 0)
// @ts-expect-error Asynchronous stateful folds belong at a for-await consumption boundary.
exstream.pipeline<number>().asyncReduce(async (total, value) => total + value, 0)

const publicState = exstream([1])
const isPaused: boolean = publicState.paused
// @ts-expect-error Pressure gates are internal scheduler state.
void publicState.pausedFromInside
// @ts-expect-error Pressure gates are internal scheduler state.
void publicState.pausedFromOutside
// @ts-expect-error Graph links are internal implementation details.
void publicState.source
// @ts-expect-error Pipeline chain links are internal implementation details.
void publicState.endOfChain

exstream([{ a: 1 }]).map((value) => {
  // @ts-expect-error Direct mutation cannot add a field to the inferred object type.
  value.b = 2
  return value
})

void correlationId
void requestId
void batchInput
void contributingContext
void webReadable
void asyncIterator
void destinationCompletion
void customDestinationCompletion
void nodeReadable
void nodeTransform
void transformedByNode
void isPaused
void typedErrorData
type Used =
  | EnrichedValue
  | NodeThroughValue
  | EnrichedObject
  | NarrowedValue
  | ErrorDataValue
  | BatchValue
  | UniqueCustomer
  | InnerJoinValue
  | LeftJoinValue
  | ReducedWithoutInitial
  | MappedPromiseValue
  | CsvObject
  | CsvArray
  | JsonRowValue
  | UnknownJsonValue
  | JsonlRowValue
  | JsonOutputValue
  | JsonlOutputValue
  | PipelineValue
  | AggregatedPipelineValue
  | RecoveredAsyncValue
  | NestedPipelineValue
  | typeof pipeCompletion
  | typeof errorOrigin
  | ForkValue
  | ForkContext
  | MergedValue
  | RoutedOutput
  | DeadLetter
declare const used: Used
void used