const _ = require('./src')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const arr = []
for(let i = 0; i < 4000; i++) arr.push(i)

;(async () => {
  let counter = 0, counter2 = 0, counter3 = 0

  const interval = setInterval(() => {
    console.log(counter, counter2, counter3)
  }, 200)

  const res = await _(arr)
    .tap(() => ++counter)
    .map(async x => {
      await sleep(Math.floor(Math.random() * 50))
      return x
    })
    .resolve(5, false)
    .tap(() => --counter)
    .tap(() => ++counter3)
    .map(async x => sleep(100))
    .resolve(5, false)
    .tap(() => --counter3)
    .tap(() => ++counter2)
    .errors(e => console.error(e))
    // .tap(() => console.log(counter, ++counter2))
    .toPromise()
  console.log(res.length)
  clearInterval(interval)
})()
