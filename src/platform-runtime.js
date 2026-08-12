const { runtime } = require('./runtime.js')

/* v8 ignore else -- The browser branch is executed by the headless browser harness. */
if (runtime.platform === null) require('./node-runtime.js')