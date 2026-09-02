import exstream = require('../../types/index')

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type Value<S> = S extends exstream.Exstream<infer T, any> ? T : never

const log = <T>(message: string | ((value: T) => unknown)) =>
  function logTransform<C extends object>(
    stream: exstream.Exstream<T, C>,
  ): exstream.Exstream<T, C> {
    return stream.tap((value) => {
      if (typeof message !== 'string') message(value)
    })
  }

const logged = exstream([1]).through(
  log((value) => {
    const inferred: number = value
    return inferred
  }),
)
const loggedMessage = exstream([1]).through(log('done'))

const loggedPipeline = exstream.pipeline<number>().through(
  log((value) => {
    const inferred: number = value
    return inferred
  }),
)
const loggedPipelineResult = exstream([1]).through(loggedPipeline)

declare const condition: boolean
const pipeline = condition
  ? exstream.pipeline<number>().map(String)
  : exstream.pipeline<number>().map(Boolean)

const result = exstream([1]).through(pipeline)

// @ts-expect-error A pipeline that consumes strings cannot be attached to a numeric source.
exstream([1]).through(exstream.pipeline<string>())

type PipelineOutput = Expect<Equal<exstream.PipelineValue<typeof pipeline>, string | boolean>>
type ResultValue = Expect<Equal<Value<typeof result>, string | boolean>>
type LoggedValue = Expect<Equal<Value<typeof logged>, number>>
type LoggedMessageValue = Expect<Equal<Value<typeof loggedMessage>, number>>
type LoggedPipelineValue = Expect<Equal<Value<typeof loggedPipelineResult>, number>>

type Used = PipelineOutput | ResultValue | LoggedValue | LoggedMessageValue | LoggedPipelineValue
declare const used: Used
void used