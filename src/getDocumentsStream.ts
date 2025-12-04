import {getUserAgent} from './getUserAgent.js'
import {getSource} from './options.js'
import {requestStream} from './requestStream.js'
import type {ExportSource, NormalizedExportOptions, ResponseStream} from './types.js'

type GetDocumentStreamOptions = Partial<NormalizedExportOptions> &
  Pick<
    NormalizedExportOptions,
    'client' | 'types' | 'maxRetries' | 'retryDelayMs' | 'readTimeout'
  > &
  ExportSource

export function getDocumentsStream(options: GetDocumentStreamOptions): Promise<ResponseStream> {
  // Sanity client doesn't handle streams natively since we want to support node/browser
  // with same API. We're just using it here to get hold of URLs and tokens.
  const source = getSource(options)
  const baseUrl = options.client.getUrl(
    source.type === 'dataset'
      ? `/data/export/${source.id}`
      : `/media-libraries/${source.id}/export`,
  )

  const url = new URL(baseUrl)
  if (options.types && options.types.length > 0) {
    url.searchParams.set('types', options.types.join())
  }

  const token = options.client.config().token
  const headers: Record<string, string> = {
    'User-Agent': getUserAgent(),
    ...(token ? {Authorization: `Bearer ${token}`} : {}),
  }

  return requestStream({
    url: url.toString(),
    headers,
    maxRetries: options.maxRetries,
    ...(options.retryDelayMs !== undefined ? {retryDelayMs: options.retryDelayMs} : {}),
    readTimeout: options.readTimeout,
  })
}
