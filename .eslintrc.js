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
    // 'promise',
    // 'sonarjs',
  ],
  extends: [
    'node-opinionated',
    // 'plugin:security/recommended',
    // 'plugin:sonarjs/recommended',
    // 'plugin:promise/recommended',
    'plugin:jest/recommended',
  ],
  overrides: [
    {
      files: ['src/**'],
      rules: {
        // 'max-lines': ['warn', 100],
        'no-multi-assign': 'off',
        'no-undefined': 'off',
        'max-nested-callbacks': ['warn', 3],
        'object-curly-spacing': 'off',
        'security/detect-object-injection': 'off',
      },
    },{
      files: ['test/**'],
      rules: {
        'max-lines': ['warn', 250],
        'max-nested-callbacks': ['warn', 3],
        'no-await-in-loop': 'off',
        'no-console': 'off',
        'no-undefined': 'off',
        'no-sync': 'off',
        'no-return-assign': 'off',
        'object-curly-spacing': 'off',
        'require-await': 'off',
        'jest/no-done-callback': 'off',
        'node/no-unpublished-require': 'off',
        'security/detect-object-injection': 'off',
        'sonarjs/no-duplicate-string': 'off',
        'sonarjs/no-identical-functions': 'off',
      },
    },
  ],
}
