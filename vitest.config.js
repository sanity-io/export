const {defineConfig} = require('vitest/config')

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'test/'],
    },
  },
})
