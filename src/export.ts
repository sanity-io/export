import {createWriteStream} from 'node:fs'
import {mkdir, mkdtemp, rename, rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join as joinPath} from 'node:path'
import type {Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {deprecate} from 'node:util'
import {constants as zlib, createGzip} from 'node:zlib'

import {isWritableStream, split, throughObj} from './util/streamHelpers.js'
import {createTarArchive} from './util/tarArchive.js'
import {AssetHandler} from './AssetHandler.js'
import {MODE_STREAM} from './constants.js'
import {downloadReferencedAssets} from './downloadReferencedAssets.js'
import {filterDocuments} from './filterDocuments.js'
import {filterDocumentTypes} from './filterDocumentTypes.js'
import {getDocumentCursorStream} from './getDocumentCursorStream.js'
import {getDocumentsStream} from './getDocumentsStream.js'
import {logFirstChunk} from './logFirstChunk.js'
import {rejectOnApiError} from './rejectOnApiError.js'
import {stringifyAssetMap} from './stringifyAssetMap.js'
import {stringifyStream} from './stringifyStream.js'
import {tryParseJson} from './tryParseJson.js'
import type {
  ExportOptions,
  NormalizedExportOptions,
  ExportResult,
  ResponseStream,
  SanityDocument,
} from './types.js'
import {getSource, validateOptions} from './options.js'

const noop = (): null => null

/**
 * Export the dataset with the given options.
 *
 * @param opts - Export options
 * @returns The export result
 * @public
 */
export async function exportDataset(
  opts: ExportOptions & {outputPath: Writable},
): Promise<ExportResult<Writable>>
export async function exportDataset(
  opts: ExportOptions & {outputPath: string},
): Promise<ExportResult<string>>
export async function exportDataset(opts: ExportOptions): Promise<ExportResult>
export async function exportDataset(opts: ExportOptions): Promise<ExportResult> {
  const options = validateOptions(opts)
  const onProgress = options.onProgress ?? noop
  const source = getSource(opts)
  const prefix = `${source.id}-export-${new Date()
    .toISOString()
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase()}`
  const tmpDir = await mkdtemp(joinPath(tmpdir(), `${prefix}-`))
  const dataPath = joinPath(tmpDir, 'data.ndjson')
  const assetsPath = joinPath(tmpDir, 'assets.json')
  const abortController = new AbortController()
  options.signal = abortController.signal
  const assetHandler = new AssetHandler({
    client: options.client,
    tmpDir,
    ...(options.assetConcurrency !== undefined && {concurrency: options.assetConcurrency}),
    ...(options.retryDelayMs !== undefined && {retryDelayMs: options.retryDelayMs}),
    maxRetries: options.maxAssetRetries,
    readTimeout: options.readTimeout,
    strictAssetVerification: options.strictAssetVerification,
    onError: (error) => abortController.abort(error),
  })
  const destination = isWritableStream(options.outputPath) ? options.outputPath : undefined
  const onDestinationError = (error: Error) => assetHandler.fail(error)
  destination?.on('error', onDestinationError)
  let outputTemporaryPath: string | undefined
  let progressInterval: ReturnType<typeof setInterval> | undefined
  let documentCount = 0
  let lastReported = 0

  try {
    await mkdir(joinPath(tmpDir, 'files'))
    await mkdir(joinPath(tmpDir, 'images'))
    let assetStreamHandler = assetHandler.noop
    if (!options.raw) {
      assetStreamHandler = options.assets ? assetHandler.rewriteAssets : assetHandler.stripAssets
    }
    const filterTransform = throughObj((doc: SanityDocument, _enc, callback) => {
      try {
        callback(null, options.filterDocument(doc) ? doc : undefined)
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    })
    const transformTransform = throughObj((doc: SanityDocument, _enc, callback) => {
      try {
        callback(null, options.transformDocument(doc))
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    })
    const reportTransform = throughObj((doc: SanityDocument, _enc, callback) => {
      if (!options.raw && options.assets) assetHandler.trackDocumentAssets(doc, doc._id)
      documentCount++
      if (Date.now() - lastReported > 50) {
        onProgress({
          step: 'Exporting documents...',
          current: documentCount,
          total: '?',
          update: true,
        })
        lastReported = Date.now()
      }
      callback(null, doc)
    })
    onProgress({step: 'Exporting documents...'})
    const inputStream = await getDocumentInputStream(options)
    await pipeline(
      inputStream,
      logFirstChunk(),
      split(tryParseJson),
      rejectOnApiError(),
      filterDocuments(options.drafts),
      filterDocumentTypes(options.types),
      assetStreamHandler,
      filterTransform,
      transformTransform,
      reportTransform,
      stringifyStream(),
      createWriteStream(dataPath),
      {signal: abortController.signal},
    )
    onProgress({
      step: 'Exporting documents...',
      current: documentCount,
      total: documentCount,
      update: true,
    })
    if (!options.raw && options.assets) {
      onProgress({step: 'Downloading assets...'})
      progressInterval = setInterval(
        () =>
          onProgress({
            step: 'Downloading assets...',
            current: assetHandler.queueSize - assetHandler.queue.size - assetHandler.queue.pending,
            total: assetHandler.queueSize,
            update: true,
          }),
        500,
      )
      await downloadReferencedAssets(assetHandler, options)
    }
    const assetMap = await assetHandler.finish()
    clearInterval(progressInterval)
    onProgress({
      step: 'Downloading assets...',
      current: assetHandler.queueSize,
      total: assetHandler.queueSize,
      update: true,
    })
    await pipeline(stringifyAssetMap(assetMap), createWriteStream(assetsPath))

    const archive = createTarArchive()
    let output: Writable
    if (isWritableStream(options.outputPath)) {
      output = options.outputPath
    } else {
      outputTemporaryPath = `${options.outputPath}.${randomUUID()}.partial`
      output = createWriteStream(outputTemporaryPath, {flags: 'wx'})
    }
    const gzip = createGzip({
      level: options.compress ? zlib.Z_DEFAULT_COMPRESSION : zlib.Z_NO_COMPRESSION,
    })
    const writing = pipeline(archive.stream, gzip, output)
    // Register rejection handling before adding entries, which can themselves fail.
    void writing.catch(() => {})
    try {
      onProgress({step: 'Adding assets to archive...'})
      await archive.addFile(dataPath, `${prefix}/data.ndjson`)
      if (options.assetsMap) await archive.addFile(assetsPath, `${prefix}/assets.json`)
      await archive.addDirectory(joinPath(tmpDir, 'files'), `${prefix}/files`)
      await archive.addDirectory(joinPath(tmpDir, 'images'), `${prefix}/images`)
      archive.finalize()
      await writing
    } catch (error) {
      archive.abort(error)
      await writing.catch(noop)
      throw error
    }
    if (outputTemporaryPath && typeof options.outputPath === 'string') {
      await rename(outputTemporaryPath, options.outputPath)
      outputTemporaryPath = undefined
    }
    return {outputPath: options.outputPath, documentCount, assetCount: assetHandler.filesWritten}
  } catch (error) {
    abortController.abort(error)
    assetHandler.clear()
    if (isWritableStream(options.outputPath)) {
      options.outputPath.destroy()
    }
    throw assetHandler.rejectedError ?? error
  } finally {
    try {
      clearInterval(progressInterval)
      // Downloads must stop before their temporary files are removed.
      await assetHandler.queue.onIdle()
      onProgress({step: 'Clearing temporary files...'})
      await rm(tmpDir, {recursive: true, force: true}).catch(noop)
      if (outputTemporaryPath) await rm(outputTemporaryPath, {force: true}).catch(noop)
    } finally {
      destination?.off('error', onDestinationError)
    }
  }
}

function getDocumentInputStream(options: NormalizedExportOptions): Promise<ResponseStream> {
  return options.mode === MODE_STREAM
    ? getDocumentsStream(options)
    : getDocumentCursorStream(options)
}

type MediaLibraryExportOptions = Omit<ExportOptions, 'dataset' | 'mediaLibraryId'> & {
  mediaLibraryId: string
}

/**
 * Export the media library with the given `mediaLibraryId`.
 *
 * @param options - Export options
 * @returns The export result
 * @public
 */
export async function exportMediaLibrary(
  options: MediaLibraryExportOptions & {outputPath: Writable},
): Promise<ExportResult<Writable>>
export async function exportMediaLibrary(
  options: MediaLibraryExportOptions & {outputPath: string},
): Promise<ExportResult<string>>
export async function exportMediaLibrary(options: MediaLibraryExportOptions): Promise<ExportResult>
export async function exportMediaLibrary(
  options: MediaLibraryExportOptions,
): Promise<ExportResult> {
  return exportDataset(options as ExportOptions)
}

/**
 * Alias for `exportDataset`, for backwards compatibility.
 * Use named `exportDataset` instead.
 *
 * @deprecated Default export is deprecated and will be removed in a future release. Use named "exportDataset" function instead.
 * @public
 */
export default deprecate(
  function deprecatedExport(opts: ExportOptions): Promise<ExportResult> {
    return exportDataset(opts)
  },
  `Default export of "@sanity/export" is deprecated and will be removed in a future release. Please use the named "exportDataset" function instead.`,
  'DEP_SANITY_EXPORT_DEFAULT',
)
