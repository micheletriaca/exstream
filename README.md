# Exstream

```shell
yarn add exstream.js

# or

npm install exstream.js
```

## How to use it

Here is a sync example:

```javascript
const exs = require('exstream.js');

const res = exs([1, 2, 3])
  .reduce((memo, x) => memo + x, 0)
  .value()

// res is 6
```

See more examples in the [test folder](./test).

