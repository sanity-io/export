import {createHash} from 'node:crypto'
import {createWriteStream, mkdirSync} from 'node:fs'
import {join as joinPath} from 'node:path'
import {pipeline} from 'node:stream/promises'

import PQueue from 'p-queue'

import {delay} from './util/delay.js'
import {through, throughObj} from './util/streamHelpers.js'
import {
  ASSET_DOWNLOAD_CONCURRENCY,
  ASSET_DOWNLOAD_MAX_RETRIES,
  DEFAULT_RETRY_DELAY,
} from './constants.js'
import {debug} from './debug.js'
import {getUserAgent} from './getUserAgent.js'
import {requestStream} from './requestStream.js'
import type {
  AssetDocument,
  AssetMap,
  AssetMetadata,
  ResponseStream,
  SanityClientLike,
  SanityDocument,
} from './types.js'
import {rm} from 'node:fs/promises'

const EXCLUDE_PROPS = ['_id', '_type', 'assetId', 'extension', 'mimeType', 'path', 'url']
const ACTION_REMOVE = 'remove' as const
const ACTION_REWRITE = 'rewrite' as const

type AssetAction = typeof ACTION_REMOVE | typeof ACTION_REWRITE

interface AssetHandlerOptions {
  client: SanityClientLike
  tmpDir: string
  prefix?: string
  concurrency?: number
  maxRetries?: number
  retryDelayMs?: number
  queue?: PQueue
}

interface AssetRequestOptions {
  url: string
  headers: Record<string, string>
}

interface AssetField {
  asset: {
    _ref: string
  }
  [key: string]: unknown
}

interface RewrittenAssetField {
  _sanityAsset: string
  [key: string]: unknown
}

interface DownloadError extends Error {
  statusCode?: number
}

export class AssetHandler {
  client: SanityClientLike
  tmpDir: string
  assetDirsCreated: boolean
  downloading: string[]
  assetsSeen: Map<string, string>
  assetMap: AssetMap
  filesWritten: number
  queueSize: number
  maxRetries: number
  retryDelayMs: number | undefined
  queue: PQueue
  rejectedError: Error | null
  reject: (err: Error) => void

  constructor(options: AssetHandlerOptions) {
    const concurrency = options.concurrency ?? ASSET_DOWNLOAD_CONCURRENCY
    debug('Using asset download concurrency of %d', concurrency)

    this.client = options.client
    this.tmpDir = options.tmpDir
    this.assetDirsCreated = false

    this.downloading = []
    this.assetsSeen = new Map()
    this.assetMap = {}
    this.filesWritten = 0
    this.queueSize = 0
    this.maxRetries = options.maxRetries ?? ASSET_DOWNLOAD_MAX_RETRIES
    this.retryDelayMs = options.retryDelayMs
    this.queue = options.queue ?? new PQueue({concurrency})

    this.rejectedError = null
    this.reject = (err: Error): void => {
      this.rejectedError = err
    }
  }

  clear(): void {
    this.assetsSeen.clear()
    this.queue.clear()
    this.queueSize = 0
  }

  finish(): Promise<AssetMap> {
    return new Promise((resolve, reject) => {
      if (this.rejectedError) {
        reject(this.rejectedError)
        return
      }

      this.reject = reject
      void this.queue.onIdle().then(() => resolve(this.assetMap))
    })
  }

  // Called when we want to download all assets to local filesystem and rewrite documents to hold
  // placeholder asset references (_sanityAsset: 'image@file:///local/path')
  rewriteAssets = throughObj(
    (doc: SanityDocument | AssetDocument, _enc: BufferEncoding, callback) => {
      if (['sanity.imageAsset', 'sanity.fileAsset'].includes(doc._type)) {
        const assetDoc = doc as AssetDocument
        const type = doc._type === 'sanity.imageAsset' ? 'image' : 'file'
        const filePath = `${type}s/${generateFilename(doc._id)}`
        this.assetsSeen.set(doc._id, type)
        this.queueAssetDownload(assetDoc, filePath)
        callback()
        return
      }

      callback(null, this.findAndModify(doc, ACTION_REWRITE))
    },
  )

  // Called in the case where we don't _want_ assets, so basically just remove all asset documents
  // as well as references to assets (*.asset._ref ^= (image|file)-)
  stripAssets = throughObj((doc: SanityDocument, _enc: BufferEncoding, callback) => {
    if (['sanity.imageAsset', 'sanity.fileAsset'].includes(doc._type)) {
      callback()
      return
    }

    callback(null, this.findAndModify(doc, ACTION_REMOVE))
  })

  // Called when we are using raw export mode along with `assets: false`, where we simply
  // want to skip asset documents but retain asset references (useful for data mangling)
  skipAssets = throughObj((doc: SanityDocument, _enc: BufferEncoding, callback) => {
    const isAsset = ['sanity.imageAsset', 'sanity.fileAsset'].includes(doc._type)
    if (isAsset) {
      callback()
      return
    }

    callback(null, doc)
  })

  noop = throughObj((doc: SanityDocument, _enc: BufferEncoding, callback) => callback(null, doc))

  queueAssetDownload(assetDoc: AssetDocument, dstPath: string): void {
    if (!assetDoc.url) {
      debug('Asset document "%s" does not have a URL property, skipping', assetDoc._id)
      return
    }

    debug('Adding download task for %s (destination: %s)', assetDoc._id, dstPath)
    this.queueSize++
    this.downloading.push(assetDoc.url)

    const doDownload = async (): Promise<boolean> => {
      let dlError: DownloadError | undefined
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          return await this.downloadAsset(assetDoc, dstPath)
        } catch (err) {
          const downloadError = err as DownloadError
          // Ignore inaccessible assets
          switch (downloadError.statusCode) {
            case 401:
            case 403:
            case 404:
              console.warn(
                `⚠ Asset failed with HTTP %d (ignoring): %s`,
                downloadError.statusCode,
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

          dlError = downloadError

          if (
            downloadError.statusCode &&
            downloadError.statusCode >= 400 &&
            downloadError.statusCode < 500
          ) {
            // Don't retry on client errors
            break
          }

          await delay(this.retryDelayMs ?? DEFAULT_RETRY_DELAY)
        }
      }
      throw new Error(dlError?.message ?? 'Unknown error downloading asset')
    }

    this.queue
      .add(() =>
        doDownload().catch((err: unknown) => {
          debug('Failed to download the asset, aborting download', err)
          this.queue.clear()
          this.reject(err instanceof Error ? err : new Error(String(err)))
        }),
      )
      .catch((error: unknown) => {
        debug('Queued task failed', error)
      })
  }

  maybeCreateAssetDirs(): void {
    if (this.assetDirsCreated) {
      return
    }

    mkdirSync(joinPath(this.tmpDir, 'files'), {recursive: true})
    mkdirSync(joinPath(this.tmpDir, 'images'), {recursive: true})
    this.assetDirsCreated = true
  }

  getAssetRequestOptions(assetDoc: AssetDocument): AssetRequestOptions {
    const token = this.client.config().token
    const headers: Record<string, string> = {'User-Agent': getUserAgent()}
    const isImage = assetDoc._type === 'sanity.imageAsset'

    const url = URL.parse(assetDoc.url ?? '')
    // If we can't parse it, return as-is
    if (!url) {
      return {url: assetDoc.url ?? '', headers}
    }

    if (
      isImage &&
      token &&
      (url.hostname === 'cdn.sanity.io' ||
        url.hostname === 'cdn.sanity.work' ||
        // used in tests. use a very specific port to avoid conflicts
        url.host === 'localhost:43216')
    ) {
      headers.Authorization = `Bearer ${token}`
      url.searchParams.set('dlRaw', 'true')
    }

    return {url: url.toString(), headers}
  }

  async downloadAsset(assetDoc: AssetDocument, dstPath: string): Promise<boolean> {
    const {url} = assetDoc

    debug('Downloading asset %s', url)

    const options = this.getAssetRequestOptions(assetDoc)

    let stream: ResponseStream
    try {
      stream = await requestStream({
        maxRetries: 0, // We handle retries ourselves in queueAssetDownload
        ...options,
      })
    } catch (err) {
      const message = 'Failed to create asset stream'
      if (err instanceof Error) {
        err.message = `${message}: ${err.message}`
        throw err
      }

      throw new Error('Failed create asset stream', {cause: err})
    }

    if (stream.statusCode !== 200) {
      let errMsg: string
      try {
        const err = await tryGetErrorFromStream(stream)
        errMsg = `Referenced asset URL "${url}" returned HTTP ${stream.statusCode}`
        if (err) {
          errMsg = `${errMsg}: ${err}`
        }
      } catch (err) {
        const message = 'Failed to parse error response from asset stream'
        if (err instanceof Error) {
          err.message = `${message}: ${err.message}`
          throw err
        }

        throw new Error(message, {cause: err})
      }

      const streamError: DownloadError = new Error(errMsg)
      if (stream.statusCode !== undefined) {
        streamError.statusCode = stream.statusCode
      }
      throw streamError
    }

    this.maybeCreateAssetDirs()

    debug('Asset stream ready, writing to filesystem at %s', dstPath)
    const tmpPath = joinPath(this.tmpDir, dstPath)
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

      if (err instanceof Error) {
        err.message = `${message}: ${err.message}`
        throw err
      }

      throw new Error(message, {cause: err})
    }

    // Verify it against our downloaded stream to make sure we have the same copy
    const contentLength = stream.headers?.['content-length']
    const remoteSha1 = stream.headers?.['x-sanity-sha1']
    const remoteMd5 = stream.headers?.['x-sanity-md5']
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
          parseInt(String(contentLength), 10) !== size &&
          `Asset should be ${contentLength} bytes, got ${size}`,
      ]

      const detailsString = `Details:\n - ${details.filter(Boolean).join('\n - ')}`

      await rm(tmpPath, {recursive: true, force: true})

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

  findAndModify = (item: unknown, action: AssetAction): unknown => {
    if (Array.isArray(item)) {
      const children = item.map((child: unknown) => this.findAndModify(child, action))
      return children.filter((child): child is NonNullable<typeof child> => child != null)
    }

    if (!item || typeof item !== 'object') {
      return item
    }

    const record = item as Record<string, unknown>

    const isAsset = isAssetField(record)
    if (isAsset && action === ACTION_REMOVE) {
      return undefined
    }

    if (isAsset && action === ACTION_REWRITE) {
      const {asset, ...other} = record
      const assetId = asset._ref
      const assetType = getAssetType(record)
      const filePath = `${assetType}s/${generateFilename(assetId)}`
      const modified = this.findAndModify(other, action)
      return {
        _sanityAsset: `${assetType}@file://./${filePath}`,
        ...(typeof modified === 'object' && modified !== null ? modified : {}),
      } as RewrittenAssetField
    }

    const newItem: Record<string, unknown> = {}
    const keys = Object.keys(record)
    for (const key of keys) {
      const value = record[key]

      newItem[key] = this.findAndModify(value, action)

      if (typeof newItem[key] === 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete newItem[key]
      }
    }

    return newItem
  }
}

function isAssetField(item: Record<string, unknown>): item is AssetField {
  const asset = item.asset as {_ref?: unknown} | undefined
  return Boolean(asset?._ref && typeof asset._ref === 'string' && isSanityAsset(asset._ref))
}

function getAssetType(item: Record<string, unknown>): string | null {
  const asset = item.asset as {_ref?: unknown} | undefined
  if (!asset || typeof asset._ref !== 'string') {
    return null
  }

  const match = asset._ref.match(/^(image|file)-/)
  return match?.[1] ?? null
}

function isSanityAsset(assetId: string): boolean {
  return (
    /^image-[a-f0-9]{40}-\d+x\d+-[a-z]+$/.test(assetId) ||
    /^file-[a-f0-9]{40}-[a-z0-9]+$/.test(assetId)
  )
}

function generateFilename(assetId: string): string {
  const match = assetId.match(/^(image|file)-(.*?)(-[a-z]+)?$/)
  const asset = match?.[2]
  const ext = match?.[3]
  const extension = (ext ?? 'bin').replace(/^-/, '')
  return asset ? `${asset}.${extension}` : `${assetId}.bin`
}

interface HashResult {
  size: number
  sha1: string
  md5: string
}

async function writeHashedStream(
  filePath: string,
  stream: NodeJS.ReadableStream,
): Promise<HashResult> {
  let size = 0
  const md5 = createHash('md5')
  const sha1 = createHash('sha1')

  const hasher = through((chunk, _enc, cb) => {
    size += chunk.length
    md5.update(chunk)
    sha1.update(chunk)
    cb(null, chunk)
  })

  await pipeline(stream, hasher, createWriteStream(filePath))
  return {
    size,
    sha1: sha1.digest('hex'),
    md5: md5.digest('hex'),
  }
}

function tryGetErrorFromStream(stream: NodeJS.ReadableStream): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let receivedData = false

    stream.on('data', (chunk: Buffer) => {
      receivedData = true
      chunks.push(chunk)
    })

    stream.on('end', () => {
      if (!receivedData) {
        resolve(null)
        return
      }

      const body = Buffer.concat(chunks)
      try {
        const parsed = JSON.parse(body.toString('utf8')) as {message?: string; error?: string}
        resolve(parsed.message ?? parsed.error ?? null)
      } catch {
        resolve(body.toString('utf8').slice(0, 16000))
      }
    })

    stream.on('error', reject)
  })
}

function omit(obj: Record<string, unknown>, keys: string[]): AssetMetadata {
  const copy: AssetMetadata = {}
  for (const [key, value] of Object.entries(obj)) {
    if (!keys.includes(key)) {
      copy[key] = value
    }
  }
  return copy
}
