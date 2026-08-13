import exstream = require('exstream.js')

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type Value<S> = S extends exstream.Exstream<infer T, any> ? T : never
type Context<S> = S extends exstream.Exstream<unknown, infer C> ? C : never

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

const reducedWithContext = exstream([1, 2]).reduce((sum, value, recordContext) => {
  const original: number = recordContext.input
  return sum + value + original
}, 0)
declare const reducedContext: Context<typeof reducedWithContext>
const contributingContext: exstream.RecordContext<unknown> | undefined =
  reducedContext.contexts?.[0]

const wrapped = exstream([1]).map(async (value) => String(value), { wrap: true })
type WrappedValue = Expect<Equal<Value<typeof wrapped>, Promise<{ input: number; output: string }>>>

const csvObjects = exstream(['id,name\n1,Ada\n']).csv({ header: true })
type CsvObject = Expect<Equal<Value<typeof csvObjects>, Record<string, string>>>

const csvArrays = exstream(['1,Ada\n']).csv()
type CsvArray = Expect<Equal<Value<typeof csvArrays>, string[]>>

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

const merged = exstream([exstream([1]), exstream([2])]).merge(2, true)
type MergedValue = Expect<Equal<Value<typeof merged>, number>>

const routed = exstream([{ id: 1 }]).routeErrors()
type RoutedOutput = Expect<Equal<Value<typeof routed.output>, { id: number }>>
type DeadLetter = Expect<
  Equal<
    Value<typeof routed.deadLetters>,
    { error: exstream.ExstreamError<{ id: number }>; input: { id: number } }
  >
>

const webReadable: ReadableStream<number> = exstream([1]).toWebReadable()
const asyncIterator: AsyncIterableIterator<number> = exstream([1]).toAsyncIterator()
const nodeTransform: exstream.NodeTransformLike<unknown, number> = exstream([1]).toNodeStream()

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
void nodeTransform
void typedErrorData
type Used =
  | EnrichedValue
  | EnrichedObject
  | NarrowedValue
  | ErrorDataValue
  | BatchValue
  | WrappedValue
  | CsvObject
  | CsvArray
  | PipelineValue
  | AggregatedPipelineValue
  | NestedPipelineValue
  | ForkValue
  | ForkContext
  | MergedValue
  | RoutedOutput
  | DeadLetter
declare const used: Used
void used