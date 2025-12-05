import {createWriteStream} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join as joinPath} from 'node:path'
import {PassThrough} from 'node:stream'
import {finished, pipeline} from 'node:stream/promises'
import {deprecate} from 'node:util'
import {constants as zlib} from 'node:zlib'

import archiver from 'archiver'
import {JsonStreamStringify} from 'json-stream-stringify'
import {rimraf} from 'rimraf'

import {AssetHandler} from './AssetHandler.js'
import {DOCUMENT_STREAM_DEBUG_INTERVAL, MODE_CURSOR, MODE_STREAM} from './constants.js'
import {debug} from './debug.js'
import {filterDocuments} from './filterDocuments.js'
import {filterDocumentTypes} from './filterDocumentTypes.js'
import {getDocumentCursorStream} from './getDocumentCursorStream.js'
import {getDocumentsStream} from './getDocumentsStream.js'
import {logFirstChunk} from './logFirstChunk.js'
import {rejectOnApiError} from './rejectOnApiError.js'
import {stringifyStream} from './stringifyStream.js'
import {tryParseJson} from './tryParseJson.js'
import {isWritableStream, split, throughObj} from './util/streamHelpers.js'
import {validateOptions} from './validateOptions.js'

const noop = () => null

export async function exportDataset(opts) {
  const options = validateOptions(opts)
  const onProgress = options.onProgress || noop
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

  const prefix = `${opts.dataset ?? opts.mediaLibraryId}-export-${slugDate}`
  const tmpDir = joinPath(tmpdir(), prefix)
  await mkdir(tmpDir, {recursive: true})
  const dataPath = joinPath(tmpDir, 'data.ndjson')
  const assetsPath = joinPath(tmpDir, 'assets.json')

  const cleanup = () =>
    rimraf(tmpDir).catch((err) => {
      debug(`Error while cleaning up temporary files: ${err.message}`)
    })

  const assetHandler = new AssetHandler({
    client: options.client,
    tmpDir,
    prefix,
    concurrency: options.assetConcurrency,
    maxRetries: options.maxAssetRetries,
    retryDelayMs: options.retryDelayMs,
  })

  debug('Downloading assets (temporarily) to %s', tmpDir)
  debug('Downloading to %s', options.outputPath === '-' ? 'stdout' : options.outputPath)

  let outputStream
  if (isWritableStream(options.outputPath)) {
    outputStream = options.outputPath
  } else {
    outputStream =
      options.outputPath === '-' ? process.stdout : createWriteStream(options.outputPath)
  }

  let assetStreamHandler = assetHandler.noop
  if (!options.raw) {
    assetStreamHandler = options.assets ? assetHandler.rewriteAssets : assetHandler.stripAssets
  }

  let resolve
  let reject
  const result = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })

  finished(archive)
    .then(async () => {
      debug('Archive finished')
    })
    .catch(async (archiveErr) => {
      debug('Archiving errored: %s', archiveErr.stack)
      await cleanup()
      reject(archiveErr)
    })

  debug('Getting dataset export stream, mode: "%s"', options.mode)
  onProgress({step: 'Exporting documents...'})

  let documentCount = 0
  let lastDocumentID = null
  let lastReported = Date.now()
  const reportDocumentCount = (doc, enc, cb) => {
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
  if (inputStream.statusCode) {
    debug('Got HTTP %d', inputStream.statusCode)
  }
  if (inputStream.headers) {
    debug('Response headers: %o', inputStream.headers)
  }

  let debugTimer = null
  function scheduleDebugTimer() {
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

  const filterTransform = throughObj((doc, _enc, callback) => {
    if (!options.filterDocument) {
      return callback(null, doc)
    }

    try {
      const include = options.filterDocument(doc)
      return include ? callback(null, doc) : callback()
    } catch (err) {
      return callback(err)
    }
  })

  const transformTransform = throughObj((doc, _enc, callback) => {
    if (!options.transformDocument) {
      return callback(null, doc)
    }

    try {
      return callback(null, options.transformDocument(doc))
    } catch (err) {
      return callback(err)
    }
  })

  const reportTransform = throughObj(reportDocumentCount)

  // Use pipeline to chain streams with proper error handling
  const jsonStream = new PassThrough()
  finished(jsonStream)
    .then(() => debug('JSON stream finished'))
    .catch((err) => reject(err))

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
  ).catch((err) => {
    if (debugTimer !== null) clearTimeout(debugTimer)
    debug(`Export stream error @ ${lastDocumentID}/${documentCount}: `, err)
    reject(err)
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
        await cleanup()
        reject(assetErr)
        return
      }

      // Add all downloaded assets to archive
      archive.directory(joinPath(tmpDir, 'files'), `${prefix}/files`, {store: true})
      archive.directory(joinPath(tmpDir, 'images'), `${prefix}/images`, {store: true})

      debug('Finalizing archive, flushing streams')
      onProgress({step: 'Adding assets to archive...'})
      await archive.finalize()
    })
    .catch(async (err) => {
      if (debugTimer !== null) clearTimeout(debugTimer)
      debug(`Export stream error @ ${lastDocumentID}/${documentCount}: `, err)
      reject(err)
    })

  pipeline(archive, outputStream)
    .then(() => onComplete())
    .catch(onComplete)

  async function onComplete(err) {
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

function getDocumentInputStream(options) {
  if (options.mode === MODE_STREAM) {
    return getDocumentsStream(options)
  }
  if (options.mode === MODE_CURSOR) {
    return getDocumentCursorStream(options)
  }

  throw new Error(`Invalid mode: ${options.mode}`)
}

/**
 * Alias for `exportDataset`, for backwards compatibility.
 * Use named `exportDataset` instead.
 *
 * @deprecated Default export is deprecated and will be removed in a future release. Use named "exportDataset" function instead.
 * @public
 */
export default deprecate(
  function deprecatedExport(opts) {
    return exportDataset(opts)
  },
  `Default export of "@sanity/export" is deprecated and will be removed in a future release. Please use the named "exportDataset" function instead.`,
  'DEP_SANITY_EXPORT_DEFAULT',
)
