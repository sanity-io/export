import {createWriteStream} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join as joinPath} from 'node:path'
import {PassThrough, type Writable} from 'node:stream'
import {finished, pipeline} from 'node:stream/promises'
import {deprecate} from 'node:util'
import {constants as zlib} from 'node:zlib'

import archiver from 'archiver'
import {JsonStreamStringify} from 'json-stream-stringify'

import {isWritableStream, split, throughObj} from './util/streamHelpers.js'
import {AssetHandler} from './AssetHandler.js'
import {DOCUMENT_STREAM_DEBUG_INTERVAL, MODE_STREAM} from './constants.js'
import {debug} from './debug.js'
import {filterDocuments} from './filterDocuments.js'
import {filterDocumentTypes} from './filterDocumentTypes.js'
import {getDocumentCursorStream} from './getDocumentCursorStream.js'
import {getDocumentsStream} from './getDocumentsStream.js'
import {logFirstChunk} from './logFirstChunk.js'
import {rejectOnApiError} from './rejectOnApiError.js'
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
  const archive = archiver('tar', {
    gzip: true,
    gzipOptions: {
      level: options.compress ? zlib.Z_DEFAULT_COMPRESSION : zlib.Z_NO_COMPRESSION,
    },
  })
  archive.on('warning', (err) => {
    debug('Archive warning: %s', err.message)
  })
  archive.on('entry', (entry) => {
    debug('Adding archive entry: %s', entry.name)
  })

  const slugDate = new Date()
    .toISOString()
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase()

  const source = getSource(opts)
  const prefix = `${source.id}-export-${slugDate}`
  const tmpDir = joinPath(tmpdir(), prefix)
  await mkdir(tmpDir, {recursive: true})
  const dataPath = joinPath(tmpDir, 'data.ndjson')
  const assetsPath = joinPath(tmpDir, 'assets.json')

  const cleanup = () =>
    rm(tmpDir, {recursive: true, force: true}).catch((err: unknown) => {
      debug(`Error while cleaning up temporary files: ${err instanceof Error ? err.message : err}`)
      return false
    })

  const assetHandler = new AssetHandler({
    client: options.client,
    tmpDir,
    prefix,
    ...(options.assetConcurrency !== undefined && {concurrency: options.assetConcurrency}),
    ...(options.retryDelayMs !== undefined && {retryDelayMs: options.retryDelayMs}),
    maxRetries: options.maxAssetRetries,
  })

  debug('Downloading assets (temporarily) to %s', tmpDir)
  debug('Downloading to %s', isWritableStream(options.outputPath) ? 'stream' : options.outputPath)

  const outputStream: Writable = isWritableStream(options.outputPath)
    ? options.outputPath
    : createWriteStream(options.outputPath)

  let assetStreamHandler = assetHandler.noop
  if (!options.raw) {
    assetStreamHandler = options.assets ? assetHandler.rewriteAssets : assetHandler.stripAssets
  }

  let resolve: (value: ExportResult) => void
  let reject: (reason: Error) => void
  const result = new Promise<ExportResult>((res, rej) => {
    resolve = res
    reject = rej
  })

  finished(archive)
    .then(() => {
      debug('Archive finished')
    })
    .catch(async (archiveErr: unknown) => {
      const err = archiveErr instanceof Error ? archiveErr : new Error(`${archiveErr}`)
      debug('Archiving errored: %s', err.stack)
      // Try cleanup, but let original error be the main rejection reason, not the cleanup
      await cleanup().catch(noop)
      reject(err)
    })

  debug('Getting dataset export stream, mode: "%s"', options.mode)
  onProgress({step: 'Exporting documents...'})

  let documentCount = 0
  let lastDocumentID: string | null = null
  let lastReported = Date.now()
  const reportDocumentCount = (
    doc: SanityDocument,
    _enc: BufferEncoding,
    cb: (err: Error | null, doc: SanityDocument) => void,
  ): void => {
    ++documentCount

    const now = Date.now()
    // We report to the `onProgress` handler every 50 ms.
    // It's up to the caller to not do too much expensive work.
    if (now - lastReported > 50) {
      onProgress({
        step: 'Exporting documents...',
        current: documentCount,
        total: '?',
        update: true,
      })

      lastReported = now
    }

    lastDocumentID = doc._id

    cb(null, doc)
  }

  const inputStream = await getDocumentInputStream(options)
  if ('statusCode' in inputStream) {
    debug('Got HTTP %d', inputStream.statusCode)
  }
  if ('headers' in inputStream) {
    debug('Response headers: %o', inputStream.headers)
  }

  let debugTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleDebugTimer(): void {
    debugTimer = setTimeout(() => {
      debug('Still streaming documents', {
        documentCount,
        lastDocumentID,
      })

      // Schedule another tick:
      scheduleDebugTimer()
    }, DOCUMENT_STREAM_DEBUG_INTERVAL)
  }

  scheduleDebugTimer()

  const filterTransform = throughObj((doc: SanityDocument, _enc: BufferEncoding, callback) => {
    try {
      const include = options.filterDocument(doc)
      if (include) {
        callback(null, doc)
      } else {
        callback()
      }
    } catch (err) {
      callback(err instanceof Error ? err : new Error(`${err}`))
    }
  })

  const transformTransform = throughObj((doc: SanityDocument, _enc: BufferEncoding, callback) => {
    try {
      callback(null, options.transformDocument(doc))
    } catch (err) {
      callback(err instanceof Error ? err : new Error(`${err}`))
    }
  })

  const reportTransform = throughObj(reportDocumentCount)

  // Use pipeline to chain streams with proper error handling
  const jsonStream = new PassThrough()
  finished(jsonStream)
    .then(() => debug('JSON stream finished'))
    .catch((err: unknown) => reject(err instanceof Error ? err : new Error(`${err}`)))

  pipeline(
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
    jsonStream,
  ).catch((err: unknown) => {
    if (debugTimer !== null) clearTimeout(debugTimer)
    debug(`Export stream error @ ${lastDocumentID}/${documentCount}: `, err)
    reject(err instanceof Error ? err : new Error(`${err}`))
  })

  pipeline(jsonStream, createWriteStream(dataPath))
    .then(async () => {
      if (debugTimer !== null) clearTimeout(debugTimer)

      debug('Export stream completed')
      onProgress({
        step: 'Exporting documents...',
        current: documentCount,
        total: documentCount,
        update: true,
      })

      debug('Adding data.ndjson to archive')
      archive.file(dataPath, {name: 'data.ndjson', prefix})

      if (!options.raw && options.assets) {
        onProgress({step: 'Downloading assets...'})
      }

      let prevCompleted = 0
      const progressInterval = setInterval(() => {
        const completed =
          assetHandler.queueSize - assetHandler.queue.size - assetHandler.queue.pending

        if (prevCompleted === completed) {
          return
        }

        prevCompleted = completed
        onProgress({
          step: 'Downloading assets...',
          current: completed,
          total: assetHandler.queueSize,
          update: true,
        })
      }, 500)

      debug('Waiting for asset handler to complete downloads')
      try {
        const assetMap = await assetHandler.finish()

        // Make sure we mark the progress as done (eg 100/100 instead of 99/100)
        onProgress({
          step: 'Downloading assets...',
          current: assetHandler.queueSize,
          total: assetHandler.queueSize,
          update: true,
        })

        const assetsStream = createWriteStream(assetsPath)
        await pipeline(new JsonStreamStringify(assetMap), assetsStream)

        if (options.assetsMap) {
          archive.file(assetsPath, {name: 'assets.json', prefix})
        }

        clearInterval(progressInterval)
      } catch (assetErr) {
        clearInterval(progressInterval)
        await cleanup().catch(noop) // Try to clean up, but ignore errors here
        reject(assetErr instanceof Error ? assetErr : new Error(`${assetErr}`))
        return
      }

      // Add all downloaded assets to archive
      archive.directory(joinPath(tmpDir, 'files'), `${prefix}/files`)
      archive.directory(joinPath(tmpDir, 'images'), `${prefix}/images`)

      debug('Finalizing archive, flushing streams')
      onProgress({step: 'Adding assets to archive...'})
      await archive.finalize()
    })
    .catch(async (err: unknown) => {
      if (debugTimer !== null) clearTimeout(debugTimer)
      debug(`Export stream error @ ${lastDocumentID}/${documentCount}: `, err)
      await cleanup().catch(noop)
      reject(err instanceof Error ? err : new Error(`${err}`))
    })

  pipeline(archive, outputStream)
    .then(() => onComplete())
    .catch(onComplete)

  async function onComplete(err?: Error): Promise<void> {
    onProgress({step: 'Clearing temporary files...'})
    await cleanup()

    if (!err) {
      debug('Export completed')
      resolve({
        outputPath: options.outputPath,
        documentCount,
        assetCount: assetHandler.filesWritten,
      })
      return
    }

    debug('Error during streaming: %s', err.stack)
    assetHandler.clear()
    reject(err)
  }

  return result
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
