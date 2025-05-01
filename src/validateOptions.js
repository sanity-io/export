const defaults = require('lodash/defaults')
const {
  DOCUMENT_STREAM_MAX_RETRIES,
  ASSET_DOWNLOAD_MAX_RETRIES,
  REQUEST_READ_TIMEOUT,
  MODE_STREAM,
  MODE_CURSOR,
} = require('./constants')

const clientMethods = ['getUrl', 'config']
const booleanFlags = ['assets', 'raw', 'compress', 'drafts']
const numberFlags = ['maxAssetRetries', 'maxRetries', 'assetConcurrency', 'readTimeout']
const exportDefaults = {
  compress: true,
  drafts: true,
  assets: true,
  assetsMap: true,
  raw: false,
  mode: MODE_STREAM,
  maxRetries: DOCUMENT_STREAM_MAX_RETRIES,
  maxAssetRetries: ASSET_DOWNLOAD_MAX_RETRIES,
  readTimeout: REQUEST_READ_TIMEOUT,
  filterDocument: () => true,
  transformDocument: (doc) => doc,
}

function validateOptions(opts) {
  const options = defaults({}, opts, exportDefaults)

  const resources = [options.dataset, options.mediaLibraryId].filter(
    (resource) => typeof resource === 'string' && resource.length !== 0,
  )

  if (resources.length === 0) {
    throw new Error(
      'either `options.dataset` or `options.mediaLibraryId` must be specified, got neither',
    )
  }

  if (resources.length === 2) {
    throw new Error(
      'either `options.dataset` or `options.mediaLibraryId` must be specified, got both',
    )
  }

  if (
    typeof options.mode !== 'string' ||
    (options.mode !== MODE_STREAM && options.mode !== MODE_CURSOR)
  ) {
    throw new Error(
      `options.mode must be either "${MODE_STREAM}" or "${MODE_CURSOR}", got "${options.mode}"`,
    )
  }

  if (options.onProgress && typeof options.onProgress !== 'function') {
    throw new Error(`options.onProgress must be a function`)
  }

  if (!options.client) {
    throw new Error('`options.client` must be set to an instance of @sanity/client')
  }

  const missing = clientMethods.find((key) => typeof options.client[key] !== 'function')
  if (missing) {
    throw new Error(
      `\`options.client\` is not a valid @sanity/client instance - no "${missing}" method found`,
    )
  }

  const clientConfig = options.client.config()
  if (!clientConfig.token) {
    throw new Error('Client is not instantiated with a `token`')
  }

  booleanFlags.forEach((flag) => {
    if (typeof options[flag] !== 'boolean') {
      throw new Error(`Flag ${flag} must be a boolean (true/false)`)
    }
  })

  numberFlags.forEach((flag) => {
    if (typeof options[flag] !== 'undefined' && typeof options[flag] !== 'number') {
      throw new Error(`Flag ${flag} must be a number if specified`)
    }
  })

  if (!options.outputPath) {
    throw new Error('outputPath must be specified (- for stdout)')
  }

  if (options.assetConcurrency && (options.assetConcurrency < 1 || options.assetConcurrency > 24)) {
    throw new Error('`assetConcurrency` must be between 1 and 24')
  }

  if (
    typeof options.filterDocument !== 'undefined' &&
    typeof options.filterDocument !== 'function'
  ) {
    throw new Error('`filterDocument` must be a function')
  }

  if (
    typeof options.transformDocument !== 'undefined' &&
    typeof options.transformDocument !== 'function'
  ) {
    throw new Error('`transformDocument` must be a function')
  }

  if (typeof assetsMap !== 'undefined' && typeof assetsMap !== 'boolean') {
    throw new Error('`assetsMap` must be a boolean')
  }

  return options
}

module.exports = validateOptions
