const pkg = require('../package.json')
const requestStream = require('./requestStream')

module.exports = (options) => {
  // Sanity client doesn't handle streams natively since we want to support node/browser
  // with same API. We're just using it here to get hold of URLs and tokens.
  const url = options.client.getUrl(`/data/export/${options.dataset}`)
  const token = options.client.config().token
  const headers = {
    'User-Agent': `${pkg.name}@${pkg.version}`,
    ...(token ? {Authorization: `Bearer ${token}`} : {}),
  }

  return requestStream({
    url,
    headers,
    maxRetries: options.maxRetries,
    readTimeout: options.readTimeout,
  })
}
