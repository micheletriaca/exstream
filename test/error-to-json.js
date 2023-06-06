module.exports = error => ({
  type: 'error',
  input: error.exstreamInput,
  message: error.message,
  stack: error.stack,
  cause: error.cause
    ? { message: error.cause.message, stack: error.cause.stack }
    : 'Not Specified',
  // error,
})
