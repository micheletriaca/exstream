module.exports = {
  env: {
    es6: true, // ES6 globals + ES6 syntax
    node: true,
    'jest/globals': true,
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2021, // ES6 syntax only
    ecmaFeatures: {
      impliedStrict: true,
      globalReturn: false,
    },
    allowImportExportEverywhere: false,
    requireConfigFile: false,
  },
  plugins: [
    'jest',
  ],
  extends: [
    'node-opinionated',
    'plugin:jest/recommended',
  ],
  overrides: [
    {
      files: ['src/**'],
      rules: {
        'max-lines-per-function': ['warn', 50],
        'max-lines': ['warn', 1500],
        'max-nested-callbacks': ['warn', 3],
        'max-statements': ['warn', 20],
        'no-multi-assign': 'off',
        'no-sync': 'off',
        'object-curly-spacing': ['warn', 'always'],
        'promise/no-promise-in-callback': 'off',
      },
    },{
      files: ['test/**'],
      rules: {
        'jest/no-done-callback': 'off',
        'max-lines': ['warn', 250],
        'max-nested-callbacks': ['warn', 3],
        'no-await-in-loop': 'off',
        'no-console': 'off',
        'no-sync': 'off',
        'no-undefined': 'off',
        'node/no-unpublished-require': 'off',
        'jest/no-conditional-expect': 'off',
        'object-curly-spacing': ['warn', 'always'],
        'require-await': 'off',
        'sonarjs/no-duplicate-string': 'off',
        'sonarjs/no-identical-functions': 'off',
      },
    },
  ],
}
