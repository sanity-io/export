module.exports = {
  env: {
    browser: false,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
  },
  extends: ['sanity', 'plugin:prettier/recommended'],
  plugins: ['prettier'],
}
