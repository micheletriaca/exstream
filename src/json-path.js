const invalidPath = (path, detail = '') => {
  const suffix = detail ? `: ${detail}` : ''
  throw Error(
    `Unsupported JSON path ${JSON.stringify(path)}${suffix}. ` +
      "Use $, .property, ['property'], [index], or [*].",
  )
}

const JSON_PATH_WILDCARD = Symbol('exstream.jsonPathWildcard')

const decodeEscape = (path, index, quote) => {
  const character = path[index]
  const escapes = {
    '"': '"',
    "'": "'",
    '/': '/',
    '\\': '\\',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
  }
  if (character === 'u') {
    const hex = path.slice(index + 1, index + 5)
    if (!/^[\dA-Fa-f]{4}$/.test(hex)) invalidPath(path, 'invalid Unicode escape')
    return { character: String.fromCharCode(Number.parseInt(hex, 16)), next: index + 5 }
  }
  if (!(character in escapes) || (character === quote && escapes[character] !== quote)) {
    invalidPath(path, 'invalid quoted-property escape')
  }
  return { character: escapes[character], next: index + 1 }
}

const readQuotedProperty = (path, start) => {
  const quote = path[start]
  let property = ''
  let index = start + 1
  while (index < path.length) {
    const character = path[index]
    if (character === quote) {
      if (path[index + 1] !== ']') invalidPath(path, 'expected ] after quoted property')
      return { next: index + 2, segment: property }
    }
    if (character === '\\') {
      const decoded = decodeEscape(path, index + 1, quote)
      property += decoded.character
      index = decoded.next
      continue
    }
    if (character.charCodeAt(0) < 0x20) invalidPath(path, 'control character in property')
    property += character
    index++
  }
  invalidPath(path, 'unterminated quoted property')
}

const parseJsonPath = (path = '$') => {
  if (typeof path !== 'string' || path.length === 0) invalidPath(path)
  if (path[0] !== '$') invalidPath(path, 'the path must start with $')
  const segments = []
  let index = 1
  while (index < path.length) {
    if (path[index] === '.') {
      const start = ++index
      if (!/[A-Za-z_$]/.test(path[index] || '')) {
        invalidPath(path, 'invalid dot-property name')
      }
      index++
      while (index < path.length && /[\w$]/.test(path[index])) index++
      segments.push(path.slice(start, index))
      continue
    }
    if (path[index] !== '[') invalidPath(path, `unexpected ${JSON.stringify(path[index])}`)
    index++
    if (path[index] === '*' && path[index + 1] === ']') {
      segments.push(JSON_PATH_WILDCARD)
      index += 2
      continue
    }
    if (path[index] === "'" || path[index] === '"') {
      const quoted = readQuotedProperty(path, index)
      segments.push(quoted.segment)
      index = quoted.next
      continue
    }
    const start = index
    while (/\d/.test(path[index] || '')) index++
    if (start === index || path[index] !== ']') invalidPath(path, 'invalid array index')
    const raw = path.slice(start, index)
    if (raw.length > 1 && raw[0] === '0')
      invalidPath(path, 'array indices cannot have leading zeroes')
    const value = Number(raw)
    if (!Number.isSafeInteger(value)) invalidPath(path, 'array index is too large')
    segments.push(value)
    index++
  }
  return segments
}

const stringifyPath = (path) => {
  const segments = parseJsonPath(path === void 0 ? '$[*]' : path)
  if (segments.length === 1 && segments[0] === JSON_PATH_WILDCARD) return []
  if (segments.length < 2 || segments.at(-1) !== JSON_PATH_WILDCARD) {
    invalidPath(path, 'jsonStringify path must end in [*]')
  }
  const properties = segments.slice(0, -1)
  if (properties.some((segment) => typeof segment !== 'string')) {
    invalidPath(path, 'jsonStringify envelope supports property segments only')
  }
  return properties
}

module.exports = {
  JSON_PATH_WILDCARD,
  parseJsonPath,
  stringifyPath,
}