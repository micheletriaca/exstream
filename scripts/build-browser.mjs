import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '..')

const browserOnly = () => ({
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
})

const shared = (outDir, logLevel) => ({
  configFile: false,
  logLevel,
  plugins: [browserOnly()],
  resolve: {
    alias: {
      './node-runtime.js': './web-runtime.js',
      './platform-runtime.js': './web-runtime.js',
    },
  },
  root,
  build: {
    minify: true,
    outDir,
    sourcemap: true,
  },
})

export const buildBrowserBundles = async ({ outDir = path.join(root, 'dist'), logLevel } = {}) => {
  await build({
    ...shared(outDir, logLevel),
    build: {
      ...shared(outDir, logLevel).build,
      emptyOutDir: true,
      lib: {
        entry: path.join(root, 'src/browser.mjs'),
        fileName: () => 'exstream.mjs',
        formats: ['es'],
      },
    },
  })

  await build({
    ...shared(outDir, logLevel),
    build: {
      ...shared(outDir, logLevel).build,
      emptyOutDir: false,
      lib: {
        entry: path.join(root, 'src/browser.js'),
        fileName: () => 'exstream.iife.min.js',
        formats: ['iife'],
        name: 'Exstream',
      },
    },
  })
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) await buildBrowserBundles()