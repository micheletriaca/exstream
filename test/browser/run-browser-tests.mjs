import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../..')
const output = await mkdtemp(path.join(tmpdir(), 'exstream-browser-'))
let server

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

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
  throw Error('Chrome or Chromium is required to run browser tests')
}

const runInChrome = async (chrome, html) => {
  const debugPort = await getOpenPort()
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${path.join(output, 'chrome-profile')}`,
      html,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let diagnostics = ''
  child.stderr.on('data', (chunk) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-4000)
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  let socket
  try {
    const deadline = Date.now() + 20_000
    let target
    while (!target && Date.now() < deadline) {
      if (child.exitCode !== null) throw Error(`Chrome exited early:\n${diagnostics}`)
      try {
        // Polling is intentionally sequential until Chrome exposes the target.
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) =>
          response.json(),
        )
        target = targets.find((candidate) => candidate.url === html)
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

    while (Date.now() < deadline) {
      // Each evaluation observes a later browser state.
      const evaluated = await evaluate('document.body && document.body.textContent')
      const text = evaluated.result.value || ''
      const result = text.match(/EXSTREAM_BROWSER_(?:PASS|FAIL)[^\n]*/)?.[0]?.trim()
      if (result) return result
      await wait(50)
    }
    throw Error(`browser harness timed out:\n${diagnostics}`)
  } finally {
    if (socket) socket.close()
    if (child.exitCode === null) child.kill()
    await Promise.race([exited, wait(2_000)])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

try {
  await build({
    configFile: false,
    root,
    plugins: [
      {
        name: 'forbid-node-builtins',
        resolveId(source) {
          if (
            source.startsWith('node:') ||
            ['buffer', 'events', 'process', 'stream', 'string_decoder'].includes(source)
          ) {
            throw Error(`browser bundle imports Node dependency: ${source}`)
          }
          return null
        },
      },
    ],
    resolve: {
      alias: {
        './node-runtime.js': './web-runtime.js',
        './platform-runtime.js': './web-runtime.js',
      },
    },
    build: {
      emptyOutDir: true,
      lib: {
        entry: path.join(root, 'src/browser.js'),
        fileName: 'exstream',
        formats: ['iife'],
        name: 'Exstream',
      },
      outDir: output,
    },
  })

  await Promise.all(
    ['index.html', 'browser-harness.js', 'worker-harness.js'].map((file) =>
      cp(path.join(directory, file), path.join(output, file)),
    ),
  )

  const bundlePath = path.join(output, 'exstream.iife.js')
  const bundle = await readFile(bundlePath, 'utf8')
  for (const forbidden of [
    '__vite-browser-external',
    'process.stdout',
    "require('stream')",
    'require("stream")',
    'node:stream',
  ]) {
    if (bundle.includes(forbidden))
      throw Error(`browser bundle contains Node dependency: ${forbidden}`)
  }

  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname
      const requested = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
      const file = path.resolve(output, `.${requested}`)
      if (!file.startsWith(`${output}${path.sep}`)) {
        response.writeHead(403).end()
        return
      }
      const type = file.endsWith('.js') ? 'text/javascript' : 'text/html'
      const contents = await readFile(file)
      response.writeHead(200, { 'content-type': type }).end(contents)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const chrome = findChrome()
  const address = server.address()
  const html = `http://127.0.0.1:${address.port}/index.html`
  const result = await runInChrome(chrome, html)
  if (!result || !result.startsWith('EXSTREAM_BROWSER_PASS')) {
    throw Error(result || 'browser harness did not report a result')
  }
  console.log(result)
} finally {
  if (server) await new Promise((resolve) => server.close(resolve))
  await rm(output, { force: true, recursive: true })
}