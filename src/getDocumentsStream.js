import {getUserAgent} from './getUserAgent.js'
import {requestStream} from './requestStream.js'

export function getDocumentsStream(options) {
  // Sanity client doesn't handle streams natively since we want to support node/browser
  // with same API. We're just using it here to get hold of URLs and tokens.
  const baseUrl = options.client.getUrl(
    options.dataset
      ? `/data/export/${options.dataset}`
      : `/media-libraries/${options.mediaLibraryId}/export`,
  )

  const url = new URL(baseUrl)
  if (options.types && options.types.length > 0) {
    url.searchParams.set('types', options.types.join())
  }

  const token = options.client.config().token
  const headers = {
    'User-Agent': getUserAgent(),
    ...(token ? {Authorization: `Bearer ${token}`} : {}),
  }

  return requestStream({
    url: url.toString(),
    headers,
    maxRetries: options.maxRetries,
    retryDelayMs: options.retryDelayMs,
    readTimeout: options.readTimeout,
  })
}
