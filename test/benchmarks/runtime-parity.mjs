import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import exstream from '../../src/index.mjs'
import { buildBrowserBundles } from '../../scripts/build-browser.mjs'
import { runRuntimeParityCases } from './runtime-parity-cases.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const output = await mkdtemp(path.join(tmpdir(), 'exstream-runtime-parity-'))
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const integerArgument = (name, fallback, { minimum = 0 } = {}) => {
  const prefix = `--${name}=`
  const argument = process.argv.slice(2).find((candidate) => candidate.startsWith(prefix))
  if (!argument) return fallback
  const value = Number(argument.slice(prefix.length))
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw Error(`${prefix}<value> must be an integer greater than or equal to ${minimum}`)
  }
  return value
}

const numberArgument = (name, fallback) => {
  const prefix = `--${name}=`
  const argument = process.argv.slice(2).find((candidate) => candidate.startsWith(prefix))
  if (!argument) return fallback
  const value = Number(argument.slice(prefix.length))
  if (!Number.isFinite(value) || value <= 0) {
    throw Error(`${prefix}<value> must be a positive finite number`)
  }
  return value
}

const options = {
  assertOrder: process.argv.includes('--assert-order'),
  json: process.argv.includes('--json'),
  maxRatio: numberArgument('max-ratio', 5),
  records: integerArgument('records', 1_000, { minimum: 1 }),
  runs: integerArgument('runs', 3, { minimum: 1 }),
  warmups: integerArgument('warmups', 1),
}

const findChrome = () => {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Try the next known browser location.
    }
  }
  throw Error('Chrome or Chromium is required to run the runtime parity benchmark')
}

const getOpenPort = async () => {
  const reservation = createServer()
  await new Promise((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', resolve)
  })
  const { port } = reservation.address()
  await new Promise((resolve) => reservation.close(resolve))
  return port
}

const benchmarkPage = ({ records, runs, warmups }) => `<!doctype html>
<meta charset="utf-8">
<title>Exstream runtime parity benchmark</title>
<body>EXSTREAM_RUNTIME_PARITY_RUNNING
<script type="module">
  const worker = new Worker('./runtime-parity-browser.worker.mjs', { type: 'module' })
  worker.addEventListener('message', ({ data }) => {
    document.body.textContent = 'EXSTREAM_RUNTIME_PARITY_RESULT ' + JSON.stringify(data)
    worker.terminate()
  })
  worker.addEventListener('error', ({ message }) => {
    document.body.textContent = 'EXSTREAM_RUNTIME_PARITY_RESULT ' + JSON.stringify({
      ok: false,
      error: message || 'browser benchmark worker failed',
    })
    worker.terminate()
  })
  worker.postMessage(${JSON.stringify({ records, runs, warmups })})
</script>`

const startServer = async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(benchmarkPage(options))
        return
      }

      const requested = decodeURIComponent(pathname)
      const file = path.resolve(output, `.${requested}`)
      if (!file.startsWith(`${output}${path.sep}`)) {
        response.writeHead(403).end()
        return
      }
      const contents = await readFile(file)
      const type = file.endsWith('.map') ? 'application/json' : 'text/javascript'
      response.writeHead(200, { 'content-type': type }).end(contents)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server
}

const runInChrome = async (chrome, url) => {
  const debugPort = await getOpenPort()
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${path.join(output, 'chrome-profile')}`,
      url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let diagnostics = ''
  child.stderr.on('data', (chunk) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-4_000)
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  let socket

  try {
    const startupDeadline = Date.now() + 20_000
    let target
    while (!target && Date.now() < startupDeadline) {
      if (child.exitCode !== null) throw Error(`Chrome exited early:\n${diagnostics}`)
      try {
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) =>
          response.json(),
        )
        target = targets.find((candidate) => candidate.url === url)
      } catch {
        // Chrome has not opened its debugging endpoint yet.
      }
      if (!target) await wait(50)
    }
    if (!target) throw Error(`Chrome debugging target did not start:\n${diagnostics}`)

    socket = new WebSocket(target.webSocketDebuggerUrl)
    await Promise.race([
      new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', reject, { once: true })
      }),
      wait(5_000).then(() => {
        throw Error('Chrome debugging socket did not open')
      }),
    ])

    let commandId = 0
    const commands = new Map()
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      const command = commands.get(message.id)
      if (!command) return
      commands.delete(message.id)
      if (message.error) command.reject(Error(message.error.message))
      else command.resolve(message.result)
    })
    const evaluate = (expression) =>
      new Promise((resolve, reject) => {
        const id = ++commandId
        commands.set(id, { reject, resolve })
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression } }))
      })

    const resultDeadline = Date.now() + 180_000
    while (Date.now() < resultDeadline) {
      const evaluated = await evaluate('document.body && document.body.textContent')
      const text = evaluated.result.value || ''
      const marker = 'EXSTREAM_RUNTIME_PARITY_RESULT '
      if (text.startsWith(marker)) {
        const message = JSON.parse(text.slice(marker.length))
        if (!message.ok) throw Error(message.error || 'browser benchmark failed')
        return message.result
      }
      await wait(50)
    }
    throw Error(`browser benchmark timed out:\n${diagnostics}`)
  } finally {
    if (socket) socket.close()
    if (child.exitCode === null) child.kill()
    await Promise.race([exited, wait(2_000)])
    if (child.exitCode === null) {
      child.kill('SIGKILL')
      await Promise.race([exited, wait(2_000)])
    }
  }
}

const formatDuration = (milliseconds) =>
  milliseconds < 1 ? `${(milliseconds * 1_000).toFixed(0)} us` : `${milliseconds.toFixed(2)} ms`

const printReport = (report) => {
  console.log(
    `Runtime parity: ${report.records} records, median of ${report.runs} run(s), ${report.warmups} warmup(s)`,
  )
  console.log(
    `Expected browser/Node ratio: ${report.minRatio.toFixed(2)}x–${report.maxRatio.toFixed(1)}x`,
  )
  console.log('')
  console.log('case                     node       chrome worker    ratio    order')
  for (const result of report.cases) {
    console.log(
      `${result.label.padEnd(24)} ${formatDuration(result.node.medianMs).padStart(10)} ` +
        `${formatDuration(result.browser.medianMs).padStart(19)} ` +
        `${`${result.ratio.toFixed(1)}x`.padStart(8)}    ${result.withinOrder ? 'PASS' : 'FAIL'}`,
    )
  }
}

let server
try {
  const node = await runRuntimeParityCases(exstream, { ...options, runtime: 'node' })

  await buildBrowserBundles({ outDir: output, logLevel: 'silent' })
  await Promise.all(
    ['runtime-parity-cases.mjs', 'runtime-parity-browser.worker.mjs'].map((file) =>
      cp(path.join(directory, file), path.join(output, file)),
    ),
  )
  server = await startServer()
  const { port } = server.address()
  const browser = await runInChrome(findChrome(), `http://127.0.0.1:${port}/`)

  const browserById = new Map(browser.cases.map((result) => [result.id, result]))
  const cases = node.cases.map((nodeResult) => {
    const browserResult = browserById.get(nodeResult.id)
    if (!browserResult) throw Error(`browser result is missing case ${nodeResult.id}`)
    const ratio = browserResult.medianMs / nodeResult.medianMs
    const minRatio = 1 / options.maxRatio
    return {
      id: nodeResult.id,
      label: nodeResult.label,
      node: nodeResult,
      browser: browserResult,
      ratio,
      withinOrder: ratio >= minRatio && ratio <= options.maxRatio,
    }
  })
  const report = {
    records: options.records,
    runs: options.runs,
    warmups: options.warmups,
    minRatio: 1 / options.maxRatio,
    maxRatio: options.maxRatio,
    node: { version: process.version, platform: process.platform, arch: process.arch },
    browser: { runtime: browser.runtime, userAgent: browser.userAgent },
    cases,
  }

  if (options.json) console.log(JSON.stringify(report, null, 2))
  else printReport(report)

  const failures = cases.filter((result) => !result.withinOrder)
  if (options.assertOrder && failures.length > 0) {
    throw Error(
      `runtime parity fell outside ${report.minRatio.toFixed(2)}x–${report.maxRatio.toFixed(
        1,
      )}x for: ${failures
        .map((result) => `${result.label} (${result.ratio.toFixed(1)}x)`)
        .join(', ')}`,
    )
  }
} finally {
  if (server) await new Promise((resolve) => server.close(resolve))
  await rm(output, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 })
}