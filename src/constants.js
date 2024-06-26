/**
 * How many retries to attempt when retrieving the document stream.
 * User overridable as `options.maxRetries`.
 *
 * Note: Only for initial connection - if download fails while streaming, we cannot easily resume.
 * @internal
 */
exports.DOCUMENT_STREAM_MAX_RETRIES = 5

/**
 * How many retries to attempt when downloading an asset.
 * User overridable as `options.maxAssetRetries`.
 * @internal
 */
exports.ASSET_DOWNLOAD_MAX_RETRIES = 10

/**
 * How many concurrent asset downloads to allow.
 * User overridable as `options.assetConcurrency`.
 * @internal
 */
exports.ASSET_DOWNLOAD_CONCURRENCY = 8

/**
 * How frequently we will `debug` log while streaming the documents.
 * @internal
 */
exports.DOCUMENT_STREAM_DEBUG_INTERVAL = 10000

/**
 * How long to wait before timing out the read of a request due to inactivity.
 * User overridable as `options.readTimeout`.
 * @internal
 */
exports.REQUEST_READ_TIMEOUT = 3 * 60 * 1000 // 3 minutes

/**
  What mode to use when exporting documents.
  stream: Export all documents in the dataset in one request, this will be consistent but might be slow on large datasets.
  cursor: Export documents using a cursor, this might lead to inconsistent results if a mutation is performed while exporting.
*/
exports.MODE_STREAM = 'stream'
exports.MODE_CURSOR = 'cursor'
