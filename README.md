# Exstream

![test](https://github.com/micheletriaca/exstream/actions/workflows/main.yaml/badge.svg)
[![Coverage Status](https://coveralls.io/repos/github/micheletriaca/exstream/badge.svg?branch=master)](https://coveralls.io/github/micheletriaca/exstream?branch=master)

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

Look at the [documentation](https://exstream-js.github.io/) or
see more examples in the [test folder](./test).
