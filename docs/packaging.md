# Packaging verification

Exstream publishes one implementation through CommonJS and ESM facades. The
default export, named ESM exports, and CommonJS properties point to the same
objects. This preserves the runtime singleton and keeps `nil`, prototype
extensions, and runtime selection consistent.

The package exposes four supported paths:

- `exstream.js` selects Node or browser through export conditions;
- `exstream.js/node` selects the Node runtime;
- `exstream.js/core` selects the portable runtime;
- `exstream.js/web` selects the portable runtime explicitly for browser code.

The headless-browser build rejects Node built-in imports and currently produces
a 60.12 kB bundle, 18.55 kB gzip, with Vite 8.2.1. It runs the same core,
Web Streams, CSV, fan-out, and worker checks in Chrome.

## Tree shaking

Tree shaking was measured with a minified Vite 8.2.1 ES build. Importing only
`escapeRegExp` from the web entry produced 61,759 bytes; importing the default
pipeline API produced 61,788 bytes. The named-only build still contained the CSV
implementation.

Named exports are therefore an ESM convenience in 0.32, not a promise of a
small operator-level bundle. The current core is CommonJS and performs required
runtime and prototype setup. Marking the package as side-effect-free would be
incorrect. Effective operator-level tree shaking requires splitting the internal
implementation into native ESM modules while preserving the single runtime
instance, and is intentionally left for a later internal refactor.