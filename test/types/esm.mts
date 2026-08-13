import exstream, { map, nil } from 'exstream.js'
import coreExstream from 'exstream.js/core'
import nodeExstream from 'exstream.js/node'
import webExstream from 'exstream.js/web'

const root: number[] = await exstream([1, 2])
  .map((value) => value * 2)
  .toPromise()
const core: number[] = await coreExstream([1, 2]).toPromise()
const node: number[] = await nodeExstream([1, 2]).toPromise()
const web: number[] = await webExstream([1, 2]).toPromise()
const mapped: number[] = await map((value: number) => value * 2, null, exstream([1, 2])).toPromise()
const end: typeof nil = nil

void root
void core
void node
void web
void mapped
void end