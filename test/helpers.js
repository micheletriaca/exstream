const { Writable } = require('stream')

const sleep = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms))

const getSlowWritable = (res = [], writeDelay = 50, highWaterMark = 0) => new Writable({
  objectMode: true,
  emitClose: true,
  autoDestroy: true,
  highWaterMark,
  async write (rec, encoding, callback) {
    res.push(rec)
    if (writeDelay === 0) callback()
    else {
      await sleep(writeDelay)
      callback()
    }
  },
})

const randomStringGenerator = (iterations = 3, simulateErrorAtIndex = -1) => {
  const alphabet = 'abcdefghijklmnopqrstuvz'.split('')
  // eslint-disable-next-line sonarjs/cognitive-complexity
  return (function * () {
    for (let i = 0; i < iterations; i++) {
      if (simulateErrorAtIndex === i) throw Error('an error')
      else {
        let s = ''
        for (let j = 0; j < 18; j++) s += alphabet[
          Math.round(Math.random() * (alphabet.length - 1))
        ]
        yield s
      }
    }
  })()
}

const fibonacci = function * (iterations) {
  let curr = 0
  let next = 1
  for (let i = 0; i < iterations; i++) {
    yield curr
    ;[curr, next] = [next, curr + next]
  }
}

module.exports = {
  sleep,
  getSlowWritable,
  randomStringGenerator,
  fibonacci,
}
