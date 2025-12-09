import type {Writable} from 'node:stream'

/**
 * The mode to use when exporting documents.
 *
 * - `"stream"` mode uses a continuous stream of documents from the source and will
 *   give a consistent snapshot of the dataset at the time the export started, but
 *   will struggle with very large datasets.
 * - `"cursor"` mode uses paginated requests to fetch documents using a cursor, and
 *   will handle very large datasets better, but may give an inconsistent snapshot if
 *   the dataset is being modified during the export.
 *
 * @public
 */
export type ExportMode = 'stream' | 'cursor'

/**
 * Minimal representation of a Sanity document.
 *
 * @public
 */
export interface SanityDocument {
  _id: string
  _type: string
  _rev?: string
  _createdAt?: string
  _updatedAt?: string
  [key: string]: unknown
}

/**
 * @public
 */
export interface ExportProgress {
  /** Description of the current export step */
  step: string

  /** Number of documents processed so far */
  current?: number

  /** Total number of documents, if known - otherwise `?` */
  total?: number | '?'

  /** Set to `true` if the progress update is a repeat of a previous one but with new values */
  update?: boolean
}

/**
 * @public
 */
export interface SanityClientLike {
  getUrl: (path: string) => string
  config: () => {token?: string}
}

/**
 * The options used to configure an export operation.
 *
 * @public
 */
export type ExportOptions = {
  /**
   * An instance of `@sanity/client`, configured with the project ID and authentication
   * token to be used for the export operation.
   */
  client: SanityClientLike

  /**
   * Either a filesystem path to write the output `tar.gz` file to, or a writable stream
   */
  outputPath: string | Writable

  /**
   * Whether or not to include asset files in the export
   */
  assets?: boolean

  /**
   * Whether or not to export the documents "raw", meaning asset documents will be
   * included as-is, referencing asset file URLs in the source dataset and project ID or
   * media library ID. Also skips downloading assets. Generally this is only useful if
   * importing to the same source and you do not want to download the assets and
   * re-upload them to the same source.
   *
   * @note This will usually cause undesirable results if imported into another project
   * or media library!
   */
  raw?: boolean

  /**
   * Whether or not to include draft documents in the export.
   */
  drafts?: boolean

  /**
   * An array of document type names to include in the export. If not specified, all types
   * will be included.
   */
  types?: string[] | undefined

  /**
   * How many asset downloads to perform concurrently. Must be between 1 and 24 if specified.
   */
  assetConcurrency?: number

  /**
   * Maximum number of times to retry downloading a failed asset.
   *
   * @note Only certain errors are retried (like network errors and 5xx responses).
   */
  maxAssetRetries?: number

  /**
   * Maximum number of times to retry fetching documents from the source.
   *
   * @note Only certain errors are retried (like network errors and 5xx responses).
   */
  maxRetries?: number

  /**
   * Delay between retry attempts in milliseconds.
   */
  retryDelayMs?: number

  /**
   * Timeout for read operations in milliseconds.
   */
  readTimeout?: number

  /**
   * The mode to use when exporting documents, either `"stream"` or `"cursor"`.
   */
  mode?: ExportMode

  /**
   * Whether or not to compress the output tarball (gzip). Note that the output will
   * still be a gzipped tarball even if this is set to `false`, setting it to `false`
   * only sets the gzip compression level to 0 (no compression).
   */
  compress?: boolean

  /**
   * Whether or not to include an `assets.json` file in the export, mapping asset IDs to
   * their custom metadata (like original filename, etc).
   */
  assetsMap?: boolean

  /**
   * Optional filter function to determine whether or not a document should be included
   * in the export. Note that this is run after any built-in document filtering such as
   * draft exclusion, document type filtering, etc.
   *
   * @param doc - The document to evaluate
   * @returns Whether or not to include the document in the export
   */
  filterDocument?: (doc: SanityDocument) => boolean

  /**
   * Optional transform function to modify a document before it is included in the export.
   * Note that this is run post-filtering, and post asset document processing.
   *
   * @param doc - The document to transform
   * @returns The transformed document
   */
  transformDocument?: (doc: SanityDocument) => Partial<SanityDocument>

  /**
   * Optional progress callback that will be called periodically during the export.
   *
   * @param progress - The current export progress
   */
  onProgress?: (progress: ExportProgress) => void
} & ExportSource

/**
 * The source of data to export, either a dataset name or a media library ID.
 *
 * @public
 */
export type ExportSource =
  | {
      /**
       * The name of the dataset to export from.
       */
      dataset: string
    }
  | {
      /**
       * The ID of the media library to export from.
       */
      mediaLibraryId: string
    }

/**
 * @public
 */
export interface ExportResult<T = string | Writable> {
  /**
   * The filesystem path or writable stream that was passed as `options.outputPath`.
   */
  outputPath: T

  /**
   * The number of documents exported.
   */
  documentCount: number

  /**
   * The number of assets exported.
   */
  assetCount: number
}

/**
 * @internal
 */
export type NormalizedExportOptions = ExportOptions & {
  assets: boolean
  raw: boolean
  drafts: boolean
  maxAssetRetries: number
  maxRetries: number
  readTimeout: number
  mode: ExportMode
  compress: boolean
  assetsMap: boolean
  filterDocument: (doc: SanityDocument) => boolean
  transformDocument: (doc: SanityDocument) => Partial<SanityDocument>
}

/**
 * @internal
 */
export interface AssetMetadata {
  [key: string]: unknown
}

/**
 * @internal
 */
export interface AssetMap {
  [assetId: string]: AssetMetadata
}

/**
 * @internal
 */
export interface RequestStreamOptions {
  url: string
  headers?: Record<string, string>
  maxRetries?: number
  retryDelayMs?: number
  readTimeout?: number
}

/**
 * @internal
 */
export interface ResponseStream extends NodeJS.ReadableStream {
  statusCode?: number
  headers?: Record<string, string | string[] | undefined>
}

/**
 * @internal
 */
export interface AssetDocument extends SanityDocument {
  _type: 'sanity.imageAsset' | 'sanity.fileAsset'
  url?: string
  path?: string
  assetId?: string
  extension?: string
  mimeType?: string
}
