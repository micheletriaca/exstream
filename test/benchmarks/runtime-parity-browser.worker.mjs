/* oxlint-disable unicorn/require-post-message-target-origin -- WorkerGlobalScope.postMessage() has no target-origin parameter. */
import exstream from './exstream.mjs'
import { runRuntimeParityCases } from './runtime-parity-cases.mjs'

self.addEventListener('message', async ({ data }) => {
  try {
    const result = await runRuntimeParityCases(exstream, {
      ...data,
      runtime: 'chrome-worker',
    })
    self.postMessage({
      ok: true,
      result: {
        ...result,
        userAgent: navigator.userAgent,
      },
    })
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.stack || error.message : String(error),
    })
  }
})