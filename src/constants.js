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
