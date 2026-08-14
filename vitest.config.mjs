import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 500,
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      thresholds: {
        branches: 87.5,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
  },
})