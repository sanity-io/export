import {
  ASSET_DOWNLOAD_MAX_RETRIES,
  DOCUMENT_STREAM_MAX_RETRIES,
  MODE_CURSOR,
  MODE_STREAM,
  REQUEST_READ_TIMEOUT,
} from './constants.js'
import type {ExportOptions, ExportSource, NormalizedExportOptions, SanityDocument} from './types.js'

const booleanFlags = ['assets', 'raw', 'compress', 'drafts'] as const
const numberFlags = ['maxAssetRetries', 'maxRetries', 'assetConcurrency', 'readTimeout'] as const

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
  filterDocument: (): boolean => true,
  transformDocument: (doc: SanityDocument): SanityDocument => doc,
} as const

export function validateOptions(opts: ExportOptions): NormalizedExportOptions {
  const options = {...exportDefaults, ...opts}

  const dataset =
    'dataset' in options && typeof options.dataset === 'string' ? options.dataset : undefined
  const mediaLibraryId =
    'mediaLibraryId' in options && typeof options.mediaLibraryId === 'string'
      ? options.mediaLibraryId
      : undefined

  if (dataset && mediaLibraryId) {
    throw new Error(
      'either `options.dataset` or `options.mediaLibraryId` must be specified, got both',
    )
  }

  if (!dataset && !mediaLibraryId) {
    throw new Error(
      'either `options.dataset` or `options.mediaLibraryId` must be specified, got neither',
    )
  }

  const source = getSource(options)
  if (!source.id.trim()) {
    throw new Error(`Source (${source.type}) specified but was empty`)
  }

  // Type narrowing for mode validation
  const mode = options.mode as string
  if (typeof mode !== 'string' || (mode !== MODE_STREAM && mode !== MODE_CURSOR)) {
    throw new Error(
      `options.mode must be either "${MODE_STREAM}" or "${MODE_CURSOR}", got "${mode}"`,
    )
  }

  if (typeof options.onProgress !== 'undefined' && typeof options.onProgress !== 'function') {
    throw new Error(`options.onProgress must be a function`)
  }

  if (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    !options.client ||
    !('config' in options.client) ||
    typeof options.client.getUrl !== 'function'
  ) {
    throw new Error('`options.client` must be set to an instance of @sanity/client')
  }

  const clientConfig = options.client.config()
  if (!clientConfig.token) {
    throw new Error('Client is not instantiated with a `token`')
  }

  for (const flag of booleanFlags) {
    if (typeof options[flag] !== 'boolean') {
      throw new Error(`Flag ${flag} must be a boolean (true/false)`)
    }
  }

  for (const flag of numberFlags) {
    if (typeof options[flag] !== 'undefined' && typeof options[flag] !== 'number') {
      throw new Error(`Flag ${flag} must be a number if specified`)
    }
  }

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

  if (typeof options.assetsMap !== 'undefined' && typeof options.assetsMap !== 'boolean') {
    throw new Error('`assetsMap` must be a boolean')
  }

  return options
}

/**
 * Determines the source type and ID from the provided options.
 *
 * @param options - The export options containing either dataset or mediaLibraryId.
 * @returns An object with the source type and its corresponding ID.
 * @internal
 */
export function getSource(options: ExportSource): {
  type: 'dataset' | 'media-library'
  id: string
} {
  if ('dataset' in options && typeof options.dataset === 'string') {
    return {type: 'dataset', id: options.dataset}
  } else if ('mediaLibraryId' in options && typeof options.mediaLibraryId === 'string') {
    return {type: 'media-library', id: options.mediaLibraryId}
  }
  throw new Error('Either dataset or mediaLibraryId must be specified')
}
