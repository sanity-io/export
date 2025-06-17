const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const archiver = require('archiver')
const miss = require('mississippi')
const split = require('split2')
const JsonStreamStringify = require('json-stream-stringify')
const AssetHandler = require('./AssetHandler')
const debug = require('./debug')
const pipeAsync = require('./util/pipeAsync')
const filterDocuments = require('./filterDocuments')
const filterDocumentTypes = require('./filterDocumentTypes')
const getDocumentsStream = require('./getDocumentsStream')
const getDocumentCursorStream = require('./getDocumentCursorStream')
const logFirstChunk = require('./logFirstChunk')
const rejectOnApiError = require('./rejectOnApiError')
const stringifyStream = require('./stringifyStream')
const tryParseJson = require('./tryParseJson')
const rimraf = require('./util/rimraf')
const validateOptions = require('./validateOptions')
const {DOCUMENT_STREAM_DEBUG_INTERVAL, MODE_CURSOR, MODE_STREAM} = require('./constants')

const noop = () => null

async function exportDataset(opts) {
  const options = validateOptions(opts)
  const onProgress = options.onProgress || noop
  const archive = archiver('tar', {
    gzip: true,
    gzipOptions: {
      level: options.compress
        ? zlib.constants.Z_DEFAULT_COMPRESSION
        : zlib.constants.Z_NO_COMPRESSION,
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
  const tmpDir = path.join(os.tmpdir(), prefix)
  fs.mkdirSync(tmpDir, {recursive: true})
  const dataPath = path.join(tmpDir, 'data.ndjson')
  const assetsPath = path.join(tmpDir, 'assets.json')

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
  })

  debug('Downloading assets (temporarily) to %s', tmpDir)
  debug('Downloading to %s', options.outputPath === '-' ? 'stdout' : options.outputPath)

  let outputStream
  if (isWritableStream(options.outputPath)) {
    outputStream = options.outputPath
  } else {
    outputStream =
      options.outputPath === '-' ? process.stdout : fs.createWriteStream(options.outputPath)
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

  miss.finished(archive, async (archiveErr) => {
    if (archiveErr) {
      debug('Archiving errored: %s', archiveErr.stack)
      await cleanup()
      reject(archiveErr)
      return
    }

    debug('Archive finished')
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

  const jsonStream = miss.pipeline(
    inputStream,
    logFirstChunk(),
    split(tryParseJson),
    rejectOnApiError(),
    filterDocuments(options.drafts),
    filterDocumentTypes(options.types),
    assetStreamHandler,
    miss.through.obj((doc, _enc, callback) => {
      if (options.filterDocument(doc)) {
        return callback(null, doc)
      }
      return callback()
    }),
    miss.through.obj((doc, _enc, callback) => {
      callback(null, options.transformDocument(doc))
    }),
    miss.through.obj(reportDocumentCount),
    stringifyStream(),
  )

  miss.pipe(jsonStream, fs.createWriteStream(dataPath), async (err) => {
    if (debugTimer !== null) clearTimeout(debugTimer)

    if (err) {
      debug(`Export stream error @ ${lastDocumentID}/${documentCount}: `, err)
      reject(err)
      return
    }

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

      const assetsStream = fs.createWriteStream(assetsPath)
      await pipeAsync(new JsonStreamStringify(assetMap), assetsStream)

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
    archive.directory(path.join(tmpDir, 'files'), `${prefix}/files`, {store: true})
    archive.directory(path.join(tmpDir, 'images'), `${prefix}/images`, {store: true})

    debug('Finalizing archive, flushing streams')
    onProgress({step: 'Adding assets to archive...'})
    await archive.finalize()
  })

  miss.pipe(archive, outputStream, onComplete)

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

function isWritableStream(val) {
  return (
    val !== null &&
    typeof val === 'object' &&
    typeof val.pipe === 'function' &&
    typeof val._write === 'function' &&
    typeof val._writableState === 'object'
  )
}

module.exports = exportDataset
