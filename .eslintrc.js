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
    'promise',
    'sonarjs',
  ],
  extends: [
    'plugin:security/recommended',
    // 'plugin:sonarjs/recommended',
    'plugin:jest/recommended',
    // 'plugin:promise/recommended',
  ],
  overrides: [
    {
      files: ['**'],
      rules: {
        // 'max-lines': ['warn', 100],
        'max-nested-callbacks': ['warn', 3],
        'comma-dangle': ['warn', 'always-multiline'],
        'jest/no-done-callback': 'off',
        'security/detect-object-injection': 'off',
      },
    },
  ],
}
