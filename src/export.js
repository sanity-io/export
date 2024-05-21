const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const archiver = require('archiver')
const miss = require('mississippi')
const split = require('split2')
const AssetHandler = require('./AssetHandler')
const debug = require('./debug')
const filterDocumentTypes = require('./filterDocumentTypes')
const filterDrafts = require('./filterDrafts')
const filterSystemDocuments = require('./filterSystemDocuments')
const getDocumentsStream = require('./getDocumentsStream')
const logFirstChunk = require('./logFirstChunk')
const rejectOnApiError = require('./rejectOnApiError')
const stringifyStream = require('./stringifyStream')
const tryParseJson = require('./tryParseJson')
const rimraf = require('./util/rimraf')
const validateOptions = require('./validateOptions')

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

  const slugDate = new Date()
    .toISOString()
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase()

  const prefix = `${opts.dataset}-export-${slugDate}`
  const tmpDir = path.join(os.tmpdir(), prefix)
  fs.mkdirSync(tmpDir, {recursive: true})
  const dataPath = path.join(tmpDir, 'data.ndjson')

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

  debug('Getting dataset export stream')
  onProgress({step: 'Exporting documents...'})

  let documentCount = 0
  let lastReported = Date.now()
  const reportDocumentCount = (chunk, enc, cb) => {
    ++documentCount

    const now = Date.now()
    if (now - lastReported > 50) {
      onProgress({
        step: 'Exporting documents...',
        current: documentCount,
        total: '?',
        update: true,
      })

      lastReported = now
    }

    cb(null, chunk)
  }

  const inputStream = await getDocumentsStream(options)
  debug('Got HTTP %d', inputStream.statusCode)
  debug('Response headers: %o', inputStream.headers)

  const jsonStream = miss.pipeline(
    inputStream,
    logFirstChunk(),
    split(tryParseJson),
    rejectOnApiError(),
    filterSystemDocuments(),
    assetStreamHandler,
    filterDocumentTypes(options.types),
    options.drafts ? miss.through.obj() : filterDrafts(),
    stringifyStream(),
    miss.through(reportDocumentCount),
  )

  miss.pipe(jsonStream, fs.createWriteStream(dataPath), async (err) => {
    if (err) {
      debug('Export stream error: ', err)
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

      archive.append(JSON.stringify(assetMap), {name: 'assets.json', prefix})
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

  archive.on('warning', (err) => {
    debug('Archive warning: %s', err.message)
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
