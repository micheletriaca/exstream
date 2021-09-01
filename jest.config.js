/*
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

module.exports = {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  verbose: false,
  // notify: true,
  notifyMode: 'change',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./jest-setup-after-environment'],
  coverageThreshold: {
    global: { branches: 90, functions: 92, lines: 92, statements: 92 },
  },
  coverageReporters: ['lcov'],
}
