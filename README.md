# Exstream

![test](https://github.com/micheletriaca/exstream/actions/workflows/main.yaml/badge.svg)
[![codecov](https://codecov.io/gh/micheletriaca/exstream/branch/master/graph/badge.svg?token=THUY7JE2UC)](https://codecov.io/gh/micheletriaca/exstream)


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

