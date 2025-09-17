/**
 * How many retries to attempt when retrieving the document stream.
 * User overridable as `options.maxRetries`.
 *
 * Note: Only for initial connection - if download fails while streaming, we cannot easily resume.
 * @internal
 */
export const DOCUMENT_STREAM_MAX_RETRIES = 5

/**
 * How many retries to attempt when downloading an asset.
 * User overridable as `options.maxAssetRetries`.
 * @internal
 */
export const ASSET_DOWNLOAD_MAX_RETRIES = 10

/**
 * How many concurrent asset downloads to allow.
 * User overridable as `options.assetConcurrency`.
 * @internal
 */
export const ASSET_DOWNLOAD_CONCURRENCY = 8

/**
 * How frequently we will `debug` log while streaming the documents.
 * @internal
 */
export const DOCUMENT_STREAM_DEBUG_INTERVAL = 10000

/**
 * How long to wait before timing out the read of a request due to inactivity.
 * User overridable as `options.readTimeout`.
 * @internal
 */
export const REQUEST_READ_TIMEOUT = 3 * 60 * 1000 // 3 minutes

/**
  What mode to use when exporting documents.
  stream: Export all documents in the dataset in one request, this will be consistent but might be slow on large datasets.
  cursor: Export documents using a cursor, this might lead to inconsistent results if a mutation is performed while exporting.
*/
export const MODE_STREAM = 'stream'
export const MODE_CURSOR = 'cursor'
