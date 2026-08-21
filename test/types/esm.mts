/// <reference types="node" />

import exstream, { defer, destination, nil } from 'exstream.js'
import coreExstream from 'exstream.js/core'
import nodeExstream from 'exstream.js/node'
import webExstream from 'exstream.js/web'
import { Transform } from 'node:stream'

const root: number[] = await exstream([1, 2])
  .map((value) => value * 2)
  .toArray()
const core: number[] = await coreExstream([1, 2]).toArray()
const node: number[] = await nodeExstream([1, 2]).toArray()
const web: number[] = await webExstream([1, 2]).toArray()
const drained: void = await exstream([1, 2]).drain()
const reusableDestination = destination<number>(async (source) => source.drain())
const written: void = await exstream([1, 2]).pipeTo(reusableDestination)
const transform = exstream.pipeline<number>().map(String).toNodeTransform()
const nativeTransform = new Transform({
  transform(chunk, _encoding, callback) {
    callback(null, chunk)
  },
})
const nativeTransformResult = exstream([Buffer.from('value')])
  .through(nativeTransform)
  .toArray()
const deferred: number[] = await defer(() => [1, 2]).toArray()
const deferredAsync: string[] = await exstream
  .defer(async () => new ReadableStream<string>())
  .toArray()
const manual = exstream([1, 2], { start: 'manual' })
const manualResult = manual.toArray()
await manual.start()
await manualResult
const end: typeof nil = nil
const writable = exstream<number | Error>()
writable.write(1)
writable.write(exstream.data(Error('ordinary value')))
writable.end()

// @ts-expect-error lifecycle controls are internal implementation details
writable.pause()
// @ts-expect-error lifecycle controls are internal implementation details
writable.resume()
// @ts-expect-error lifecycle controls are internal implementation details
writable.fail(Error('failure'))
// @ts-expect-error lifecycle controls are internal implementation details
writable.destroy()
// @ts-expect-error cancellation is supplied through AbortSignal
writable.abort()
// @ts-expect-error Error data uses write(exstream.data(error))
writable.writeData(Error('ordinary value'))
// @ts-expect-error generic helpers are not package exports
exstream.curry((value: number) => value)
// @ts-expect-error fork startup is configured on the source
manual.fork(true)
// @ts-expect-error start mode is explicit
exstream([1], { start: 'later' })

void root
void core
void node
void web
void drained
void written
void transform
void nativeTransformResult
void deferred
void deferredAsync
void end