module.exports = {
  env: {
    browser: false,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2023,
  },
  extends: ['sanity', 'plugin:prettier/recommended'],
  plugins: ['prettier'],
}
