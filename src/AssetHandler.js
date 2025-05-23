const crypto = require('crypto')
const {mkdirSync, createWriteStream} = require('fs')
const path = require('path')
const {parse: parseUrl, format: formatUrl} = require('url')
const {omit} = require('lodash')
const miss = require('mississippi')
const PQueue = require('p-queue')
const pkg = require('../package.json')
const debug = require('./debug')
const requestStream = require('./requestStream')
const rimraf = require('./util/rimraf')
const {ASSET_DOWNLOAD_MAX_RETRIES, ASSET_DOWNLOAD_CONCURRENCY} = require('./constants')

const EXCLUDE_PROPS = ['_id', '_type', 'assetId', 'extension', 'mimeType', 'path', 'url']
const ACTION_REMOVE = 'remove'
const ACTION_REWRITE = 'rewrite'

class AssetHandler {
  constructor(options) {
    const concurrency = options.concurrency || ASSET_DOWNLOAD_CONCURRENCY
    debug('Using asset download concurrency of %d', concurrency)

    this.client = options.client
    this.tmpDir = options.tmpDir
    this.assetDirsCreated = false

    this.downloading = []
    this.assetsSeen = new Map()
    this.assetMap = {}
    this.filesWritten = 0
    this.queueSize = 0
    this.maxRetries = options.maxRetries || ASSET_DOWNLOAD_MAX_RETRIES
    this.queue = options.queue || new PQueue({concurrency})

    this.rejectedError = null
    this.reject = (err) => {
      this.rejectedError = err
    }
  }

  clear() {
    this.assetsSeen.clear()
    this.queue.clear()
    this.queueSize = 0
  }

  finish() {
    return new Promise((resolve, reject) => {
      if (this.rejectedError) {
        reject(this.rejectedError)
        return
      }

      this.reject = reject
      this.queue.onIdle().then(() => resolve(this.assetMap))
    })
  }

  // Called when we want to download all assets to local filesystem and rewrite documents to hold
  // placeholder asset references (_sanityAsset: 'image@file:///local/path')
  rewriteAssets = miss.through.obj(async (doc, enc, callback) => {
    if (['sanity.imageAsset', 'sanity.fileAsset'].includes(doc._type)) {
      const type = doc._type === 'sanity.imageAsset' ? 'image' : 'file'
      const filePath = `${type}s/${generateFilename(doc._id)}`
      this.assetsSeen.set(doc._id, type)
      this.queueAssetDownload(doc, filePath, type)
      callback()
      return
    }

    callback(null, this.findAndModify(doc, ACTION_REWRITE))
  })

  // Called in the case where we don't _want_ assets, so basically just remove all asset documents
  // as well as references to assets (*.asset._ref ^= (image|file)-)
  stripAssets = miss.through.obj(async (doc, enc, callback) => {
    if (['sanity.imageAsset', 'sanity.fileAsset'].includes(doc._type)) {
      callback()
      return
    }

    callback(null, this.findAndModify(doc, ACTION_REMOVE))
  })

  // Called when we are using raw export mode along with `assets: false`, where we simply
  // want to skip asset documents but retain asset references (useful for data mangling)
  skipAssets = miss.through.obj((doc, enc, callback) => {
    const isAsset = ['sanity.imageAsset', 'sanity.fileAsset'].includes(doc._type)
    if (isAsset) {
      callback()
      return
    }

    callback(null, doc)
  })

  noop = miss.through.obj((doc, enc, callback) => callback(null, doc))

  queueAssetDownload(assetDoc, dstPath, type) {
    if (!assetDoc.url) {
      debug('Asset document "%s" does not have a URL property, skipping', assetDoc._id)
      return
    }

    debug('Adding download task for %s (destination: %s)', assetDoc._id, dstPath)
    this.queueSize++
    this.downloading.push(assetDoc.url)

    const doDownload = async () => {
      let dlError
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          return await this.downloadAsset(assetDoc, dstPath)
        } catch (err) {
          // Ignore inaccessible assets
          switch (err.statusCode) {
            case 401:
            case 403:
            case 404:
              console.warn(
                `⚠ Asset failed with HTTP %d (ignoring): %s`,
                err.statusCode,
                assetDoc._id,
              )
              return true
            default:
          }

          debug(
            `Error downloading asset %s (destination: %s), attempt %d`,
            assetDoc._id,
            dstPath,
            attempt,
            err,
          )

          dlError = err

          if ('statusCode' in err && err.statusCode >= 400 && err.statusCode < 500) {
            // Don't retry on client errors
            break
          }
        }
      }
      throw dlError
    }

    this.queue
      .add(() =>
        doDownload().catch((err) => {
          debug('Failed to download the asset, aborting download', err)
          this.queue.clear()
          this.reject(err)
        }),
      )
      .catch((error) => {
        debug('Queued task failed', error)
      })
  }

  maybeCreateAssetDirs() {
    if (this.assetDirsCreated) {
      return
    }

    /* eslint-disable no-sync */
    mkdirSync(path.join(this.tmpDir, 'files'), {recursive: true})
    mkdirSync(path.join(this.tmpDir, 'images'), {recursive: true})
    /* eslint-enable no-sync */
    this.assetDirsCreated = true
  }

  getAssetRequestOptions(assetDoc) {
    const token = this.client.config().token
    const headers = {'User-Agent': `${pkg.name}@${pkg.version}`}
    const isImage = assetDoc._type === 'sanity.imageAsset'

    const url = parseUrl(assetDoc.url, true)
    if (
      isImage &&
      token &&
      (['cdn.sanity.io', 'cdn.sanity.work'].includes(url.hostname) ||
        // used in tests. use a very specific port to avoid conflicts
        url.host === 'localhost:43216')
    ) {
      headers.Authorization = `Bearer ${token}`
      url.query = {...(url.query || {}), dlRaw: 'true'}
    }

    return {url: formatUrl(url), headers}
  }

  // eslint-disable-next-line max-statements
  async downloadAsset(assetDoc, dstPath) {
    const {url} = assetDoc

    debug('Downloading asset %s', url)

    const options = this.getAssetRequestOptions(assetDoc)

    let stream
    try {
      stream = await requestStream(options)
    } catch (err) {
      const message = 'Failed to create asset stream'
      if (typeof err.message === 'string') {
        // try to re-assign the error message so the stack trace is more visible
        err.message = `${message}: ${err.message}`
        throw err
      }

      throw new Error('Failed create asset stream', {cause: err})
    }

    if (stream.statusCode !== 200) {
      let errMsg
      try {
        const err = await tryGetErrorFromStream(stream)
        errMsg = `Referenced asset URL "${url}" returned HTTP ${stream.statusCode}`
        if (err) {
          errMsg = `${errMsg}: ${err}`
        }
      } catch (err) {
        const message = 'Failed to parse error response from asset stream'
        if (typeof err.message === 'string') {
          // try to re-assign the error message so the stack trace is more visible
          err.message = `${message}: ${err.message}`
          throw err
        }

        throw new Error(message, {cause: err})
      }

      const streamError = new Error(errMsg)
      streamError.statusCode = stream.statusCode
      throw streamError
    }

    this.maybeCreateAssetDirs()

    debug('Asset stream ready, writing to filesystem at %s', dstPath)
    const tmpPath = path.join(this.tmpDir, dstPath)
    let sha1 = ''
    let md5 = ''
    let size = 0
    try {
      const res = await writeHashedStream(tmpPath, stream)
      sha1 = res.sha1
      md5 = res.md5
      size = res.size
    } catch (err) {
      const message = 'Failed to write asset stream to filesystem'

      if (typeof err.message === 'string') {
        err.message = `${message}: ${err.message}`
        throw err
      }

      throw new Error(message, {cause: err})
    }

    // Verify it against our downloaded stream to make sure we have the same copy
    const contentLength = stream.headers['content-length']
    const remoteSha1 = stream.headers['x-sanity-sha1']
    const remoteMd5 = stream.headers['x-sanity-md5']
    const hasHash = Boolean(remoteSha1 || remoteMd5)
    const method = sha1 ? 'sha1' : 'md5'

    // Asset validity is primarily determined by the sha1 hash. However, the sha1 hash is computed
    // before certain processes (i.e. svg sanitization) which can result in a different hash.
    // When the sha1 hashes don't match, fallback to using the md5 hash.
    const sha1Differs = remoteSha1 && sha1 !== remoteSha1
    const md5Differs = remoteMd5 && md5 !== remoteMd5
    const differs = sha1Differs && md5Differs

    if (differs) {
      const details = [
        hasHash &&
          (method === 'md5'
            ? `md5 should be ${remoteMd5}, got ${md5}`
            : `sha1 should be ${remoteSha1}, got ${sha1}`),

        contentLength &&
          parseInt(contentLength, 10) !== size &&
          `Asset should be ${contentLength} bytes, got ${size}`,
      ]

      const detailsString = `Details:\n - ${details.filter(Boolean).join('\n - ')}`

      await rimraf(tmpPath)

      throw new Error(`Failed to download asset at ${assetDoc.url}. ${detailsString}`)
    }

    const isImage = assetDoc._type === 'sanity.imageAsset'
    const type = isImage ? 'image' : 'file'
    const id = `${type}-${sha1}`

    const metaProps = omit(assetDoc, EXCLUDE_PROPS)
    if (Object.keys(metaProps).length > 0) {
      this.assetMap[id] = metaProps
    }

    this.downloading.splice(
      this.downloading.findIndex((datUrl) => datUrl === url),
      1,
    )

    this.filesWritten++
    return true
  }

  findAndModify = (item, action) => {
    if (Array.isArray(item)) {
      const children = item.map((child) => this.findAndModify(child, action))
      return children.filter(function (child) {
        return child !== null && child !== undefined
      })
    }

    if (!item || typeof item !== 'object') {
      return item
    }

    const isAsset = isAssetField(item)
    if (isAsset && action === ACTION_REMOVE) {
      return undefined
    }

    if (isAsset && action === ACTION_REWRITE) {
      const {asset, ...other} = item
      const assetId = asset._ref
      const assetType = getAssetType(item)
      const filePath = `${assetType}s/${generateFilename(assetId)}`
      return {
        _sanityAsset: `${assetType}@file://./${filePath}`,
        ...this.findAndModify(other, action),
      }
    }

    const newItem = {}
    const keys = Object.keys(item)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const value = item[key]

      newItem[key] = this.findAndModify(value, action)

      if (typeof newItem[key] === 'undefined') {
        delete newItem[key]
      }
    }

    return newItem
  }
}

function isAssetField(item) {
  return item.asset && item.asset._ref && isSanityAsset(item.asset._ref)
}

function getAssetType(item) {
  if (!item.asset || typeof item.asset._ref !== 'string') {
    return null
  }

  const [, type] = item.asset._ref.match(/^(image|file)-/) || []
  return type || null
}

function isSanityAsset(assetId) {
  return (
    /^image-[a-f0-9]{40}-\d+x\d+-[a-z]+$/.test(assetId) ||
    /^file-[a-f0-9]{40}-[a-z0-9]+$/.test(assetId)
  )
}

function generateFilename(assetId) {
  const [, , asset, ext] = assetId.match(/^(image|file)-(.*?)(-[a-z]+)?$/) || []
  const extension = (ext || 'bin').replace(/^-/, '')
  return asset ? `${asset}.${extension}` : `${assetId}.bin`
}

function writeHashedStream(filePath, stream) {
  let size = 0
  const md5 = crypto.createHash('md5')
  const sha1 = crypto.createHash('sha1')

  const hasher = miss.through((chunk, enc, cb) => {
    size += chunk.length
    md5.update(chunk)
    sha1.update(chunk)
    cb(null, chunk)
  })

  return new Promise((resolve, reject) =>
    miss.pipe(stream, hasher, createWriteStream(filePath), (err) => {
      if (err) {
        reject(err)
        return
      }

      resolve({
        size,
        sha1: sha1.digest('hex'),
        md5: md5.digest('hex'),
      })
    }),
  )
}

function tryGetErrorFromStream(stream) {
  return new Promise((resolve, reject) => {
    let receivedData = false

    miss.pipe(stream, miss.concat(parse), (err) => {
      if (err) {
        reject(err)
      } else if (!receivedData) {
        // Resolve with null if no data was received, to let the caller
        // know we couldn't parse the error.
        resolve(null)
      }
    })

    function parse(body) {
      receivedData = true
      try {
        const parsed = JSON.parse(body.toString('utf8'))
        resolve(parsed.message || parsed.error || null)
      } catch (err) {
        resolve(body.toString('utf8').slice(0, 16000))
      }
    }
  })
}

module.exports = AssetHandler
