const { Writable } = require('stream')

const sleep = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms))

const getSlowWritable = (res = [], writeDelay = 50) => new Writable({
  objectMode: true,
  highWaterMark: 0,
  write (rec, encoding, callback) {
    res.push(rec)
    if (writeDelay === 0) callback()
    else sleep(writeDelay).then(callback)
  }
})

const randomStringGenerator = (iterations = 3, simulateErrorAtIndex = -1) => {
  const alphabet = 'abcdefghijklmnopqrstuvz'.split('')
  return (function * () {
    for (let i = 0; i < iterations; i++) {
      if (simulateErrorAtIndex === i) yield Error('an error')
      else {
        let s = ''
        for (let j = 0; j < 18; j++) s += alphabet[Math.round(Math.random() * (alphabet.length - 1))]
        yield s
      }
    }
  })()
}

const fibonacci = function * (iterations) {
  let curr = 0; let next = 1
  for (let i = 0; i < iterations; i++) {
    yield curr
    ;[curr, next] = [next, curr + next]
  }
}

module.exports = {
  sleep,
  getSlowWritable,
  randomStringGenerator,
  fibonacci
}
