const ERROR_ORIGINS = new Set(['source', 'operator', 'format', 'sink', 'lifecycle', 'unknown'])

const formatInfo = (error) => {
  if (!error || typeof error !== 'object') return null
  if (error.name === 'CsvParseError') return { origin: 'format', stage: 'csv' }
  if (error.name === 'CsvStringifyError') return { origin: 'format', stage: 'csvStringify' }
  if (error.name === 'JsonParseError') {
    return {
      origin: 'format',
      stage: String(error.code || '').startsWith('EXSTREAM_JSONL_') ? 'jsonl' : 'json',
    }
  }
  if (error.name === 'JsonStringifyError') {
    return {
      origin: 'format',
      stage: String(error.code || '').startsWith('EXSTREAM_JSONL_')
        ? 'jsonlStringify'
        : 'jsonStringify',
    }
  }
  return null
}

const inferredErrorInfo = (error) => {
  const format = formatInfo(error)
  if (format) return format
  if (error && error.exstreamError) return { origin: 'operator' }
  return { origin: 'unknown' }
}

const annotateError = (error, info) => {
  if (!(error instanceof Error)) return error
  const hasStoredInfo = Boolean(error.exstreamInfo)
  const current = error.exstreamInfo || inferredErrorInfo(error)
  const next = { ...current }
  for (const [key, value] of Object.entries(info || {})) {
    if (value !== void 0 && (!hasStoredInfo || next[key] === void 0 || next[key] === 'unknown')) {
      next[key] = value
    }
  }
  if (!ERROR_ORIGINS.has(next.origin)) next.origin = 'unknown'
  if (error.exstreamInput !== void 0 && next.input === void 0) next.input = error.exstreamInput
  const frozen = Object.freeze(next)
  Object.defineProperty(error, 'exstreamInfo', {
    configurable: true,
    enumerable: false,
    value: frozen,
  })
  return error
}

const errorInfo = (error) => {
  if (!(error instanceof Error)) return Object.freeze({ origin: 'unknown' })
  return error.exstreamInfo || Object.freeze(inferredErrorInfo(error))
}

module.exports = { annotateError, errorInfo }