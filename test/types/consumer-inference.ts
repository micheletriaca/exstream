import exstream = require('../../types/index')

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type Value<S> = S extends exstream.Exstream<infer T, any> ? T : never

declare const condition: boolean
const pipeline = condition
  ? exstream.pipeline<number>().map(String)
  : exstream.pipeline<number>().map(Boolean)

const result = exstream([1]).through(pipeline)

// @ts-expect-error A pipeline that consumes strings cannot be attached to a numeric source.
exstream([1]).through(exstream.pipeline<string>())

type PipelineOutput = Expect<Equal<exstream.PipelineValue<typeof pipeline>, string | boolean>>
type ResultValue = Expect<Equal<Value<typeof result>, string | boolean>>

type Used = PipelineOutput | ResultValue
declare const used: Used
void used