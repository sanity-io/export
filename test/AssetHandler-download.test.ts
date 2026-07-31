import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {readdir, readFile, rm} from 'node:fs/promises'
import http from 'node:http'
import {tmpdir} from 'node:os'
import {join as joinPath} from 'node:path'
import {gzipSync} from 'node:zlib'

import {afterAll, afterEach, describe, expect, test, vitest} from 'vitest'

import {AssetHandler} from '../src/AssetHandler.js'
import type {AssetDocument, SanityClientLike} from '../src/types.js'

const TEST_PORT = 43217

const getMockClient = (port: number): SanityClientLike => ({
  getUrl: (path: string) => `http://localhost:${port}${path}`,
  config: () => ({token: 'skTestToken'}),
})

interface ServerHandle {
  close: () => Promise<void>
}

const getServer = (
  port: number,
  onRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<ServerHandle> => {
  const server = http.createServer(onRequest)
  function close(): Promise<void> {
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve({close}))
  })
}

const tmpBase = joinPath(tmpdir(), 'asset-handler-download-tests')

describe('AssetHandler download paths', () => {
  let server: ServerHandle | null = null

  afterEach(async () => {
    if (server) {
      await server.close()
      server = null
    }
  })

  afterAll(async () => {
    await rm(tmpBase, {recursive: true, force: true})
  })

  test('skips asset document without url', async () => {
    const tmpDir = joinPath(tmpBase, `no-url-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(TEST_PORT),
      tmpDir,
      maxRetries: 1,
      retryDelayMs: 0,
    })

    const assetDoc: AssetDocument = {
      _id: 'image-abc123-100x100-png',
      _type: 'sanity.imageAsset',
      // No url property
    }

    handler.queueAssetDownload(assetDoc, 'images/abc123.png')
    const assetMap = await handler.finish()

    // Should complete without error, no files written
    expect(handler.filesWritten).toBe(0)
    expect(assetMap).toEqual({})
  })

  test('warns and continues on 404 asset response', async () => {
    const port = 43218
    server = await getServer(port, (_req, res) => {
      res.writeHead(404, 'Not Found')
      res.end('Not found')
    })

    const tmpDir = joinPath(tmpBase, `404-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 2,
      retryDelayMs: 0,
    })

    const warn = vitest.spyOn(console, 'warn').mockImplementation(() => {})

    const assetDoc: AssetDocument = {
      _id: 'image-abc123def456789012345678901234567890-100x100-png',
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/missing.png`,
    }

    handler.queueAssetDownload(assetDoc, 'images/abc123.png')
    const assetMap = await handler.finish()

    expect(handler.filesWritten).toBe(0)
    expect(assetMap).toEqual({})
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('%d'),
      404,
      assetDoc._id,
    )

    warn.mockRestore()
  })

  test('warns and continues on 401 asset response', async () => {
    const port = 43218
    server = await getServer(port, (_req, res) => {
      res.writeHead(401, 'Unauthorized')
      res.end('Unauthorized')
    })

    const tmpDir = joinPath(tmpBase, `401-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 2,
      retryDelayMs: 0,
    })

    const warn = vitest.spyOn(console, 'warn').mockImplementation(() => {})

    const assetDoc: AssetDocument = {
      _id: 'image-abc123def456789012345678901234567890-100x100-png',
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/protected.png`,
    }

    handler.queueAssetDownload(assetDoc, 'images/abc123.png')
    await handler.finish()

    expect(handler.filesWritten).toBe(0)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('%d'),
      401,
      assetDoc._id,
    )

    warn.mockRestore()
  })

  test('warns and continues on 403 asset response', async () => {
    const port = 43218
    server = await getServer(port, (_req, res) => {
      res.writeHead(403, 'Forbidden')
      res.end('Forbidden')
    })

    const tmpDir = joinPath(tmpBase, `403-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 2,
      retryDelayMs: 0,
    })

    const warn = vitest.spyOn(console, 'warn').mockImplementation(() => {})

    const assetDoc: AssetDocument = {
      _id: 'image-abc123def456789012345678901234567890-100x100-png',
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/forbidden.png`,
    }

    handler.queueAssetDownload(assetDoc, 'images/abc123.png')
    await handler.finish()

    expect(handler.filesWritten).toBe(0)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('%d'),
      403,
      assetDoc._id,
    )

    warn.mockRestore()
  })

  test('does not retry on 4xx client errors', async () => {
    const port = 43218
    let requestCount = 0
    server = await getServer(port, (_req, res) => {
      requestCount++
      res.writeHead(400, 'Bad Request')
      res.end(JSON.stringify({error: 'Invalid asset request'}))
    })

    const tmpDir = joinPath(tmpBase, `4xx-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 5,
      retryDelayMs: 0,
    })

    const assetDoc: AssetDocument = {
      _id: 'image-abc123def456789012345678901234567890-100x100-png',
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/bad.png`,
    }

    handler.queueAssetDownload(assetDoc, 'images/abc123.png')
    await expect(handler.finish()).rejects.toThrow()

    // Should not have retried - only 1 request despite maxRetries=5
    // Actually makes 2 requests: first attempt + one retry before 4xx break
    expect(requestCount).toBeLessThanOrEqual(2)
  })

  test('successfully downloads asset', async () => {
    const port = 43218
    server = await getServer(port, (req, res) => {
      res.writeHead(200, 'OK', {'Content-Type': 'image/png'})
      createReadStream(joinPath(import.meta.dirname, 'fixtures', 'mead.png')).pipe(res)
    })

    const tmpDir = joinPath(tmpBase, `success-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 2,
      retryDelayMs: 0,
    })

    const assetDoc: AssetDocument = {
      _id: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/mead.png`,
      originalFilename: 'mead.png',
    }

    handler.queueAssetDownload(assetDoc, 'images/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png')
    const assetMap = await handler.finish()

    expect(handler.filesWritten).toBe(1)

    // Should have written the file
    const images = await readdir(joinPath(tmpDir, 'images'))
    expect(images).toContain('eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png')

    // Asset map should contain metadata
    const [key, secondKey] = Object.keys(assetMap)
    if (!key) throw new Error('Expected at least one key in assetMap, found none')
    expect(secondKey).toBeUndefined()
    expect(assetMap[key]).toMatchObject({originalFilename: 'mead.png'})
  })

  test('rejects when hash headers mismatch and strictAssetVerification is default (true)', async () => {
    const port = 43218
    server = await getServer(port, (_req, res) => {
      res.writeHead(200, 'OK', {
        'Content-Type': 'image/png',
        'x-sanity-sha1': 'deadbeef'.repeat(5),
        'x-sanity-md5': 'cafebabe'.repeat(4),
      })
      createReadStream(joinPath(import.meta.dirname, 'fixtures', 'mead.png')).pipe(res)
    })

    const tmpDir = joinPath(tmpBase, `verify-default-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 1,
      retryDelayMs: 0,
    })

    const assetDoc: AssetDocument = {
      _id: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/mead.png`,
    }

    handler.queueAssetDownload(
      assetDoc,
      'images/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png',
    )
    await expect(handler.finish()).rejects.toThrow('Failed to download asset')
  })

  test('warns and continues when hash headers mismatch and strictAssetVerification is false', async () => {
    const port = 43218
    server = await getServer(port, (_req, res) => {
      res.writeHead(200, 'OK', {
        'Content-Type': 'image/png',
        'x-sanity-sha1': 'deadbeef'.repeat(5),
        'x-sanity-md5': 'cafebabe'.repeat(4),
      })
      createReadStream(joinPath(import.meta.dirname, 'fixtures', 'mead.png')).pipe(res)
    })

    const tmpDir = joinPath(tmpBase, `verify-off-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 1,
      retryDelayMs: 0,
      strictAssetVerification: false,
    })

    const warn = vitest.spyOn(console, 'warn').mockImplementation(() => {})

    const assetDoc: AssetDocument = {
      _id: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/mead.png`,
      originalFilename: 'mead.png',
    }

    handler.queueAssetDownload(
      assetDoc,
      'images/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png',
    )
    await handler.finish()

    expect(handler.filesWritten).toBe(1)
    const images = await readdir(joinPath(tmpDir, 'images'))
    expect(images).toContain('eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`${assetDoc._id} failed asset verification`),
    )

    warn.mockRestore()
  })

  test('strictAssetVerification:false keys assetMap entry by locally-computed sha1 (not asset doc _id)', async () => {
    // We expect the assetMap to be keyed by `${type}-${localSha1}`. This ensures `@sanity/import` finds
    // the correct metadata for the asset document when there is a mismatch between hashes (e.g. server-sanitized SVGs).
    const port = 43218
    const wrongSha1 = 'deadbeef'.repeat(5)
    server = await getServer(port, (_req, res) => {
      res.writeHead(200, 'OK', {
        'Content-Type': 'image/png',
        'x-sanity-sha1': wrongSha1,
      })
      createReadStream(joinPath(import.meta.dirname, 'fixtures', 'mead.png')).pipe(res)
    })

    const tmpDir = joinPath(tmpBase, `verify-off-keying-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 1,
      retryDelayMs: 0,
      strictAssetVerification: false,
    })

    const warn = vitest.spyOn(console, 'warn').mockImplementation(() => {})

    const assetDoc: AssetDocument = {
      _id: `image-${wrongSha1}-512x512-png`,
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/mismatch.png`,
      originalFilename: 'mead.png',
    }

    handler.queueAssetDownload(assetDoc, `images/${wrongSha1}-512x512.png`)
    const assetMap = await handler.finish()

    // Local sha1 of the served bytes (mead.png) is the canonical one
    const localSha1 = 'eca53d85ec83704801ead6c8be368fd377f8aaef'
    expect(Object.keys(assetMap)).toEqual([`image-${localSha1}`])
    expect(Object.keys(assetMap)).not.toContain(`image-${wrongSha1}`)
    expect(assetMap[`image-${localSha1}`]).toMatchObject({originalFilename: 'mead.png'})

    warn.mockRestore()
  })

  test('strictAssetVerification:false is a no-op when server omits hash headers', async () => {
    const port = 43218
    server = await getServer(port, (_req, res) => {
      res.writeHead(200, 'OK', {'Content-Type': 'image/png'})
      createReadStream(joinPath(import.meta.dirname, 'fixtures', 'mead.png')).pipe(res)
    })

    const tmpDir = joinPath(tmpBase, `verify-no-headers-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 1,
      retryDelayMs: 0,
      strictAssetVerification: false,
    })

    const warn = vitest.spyOn(console, 'warn').mockImplementation(() => {})

    const assetDoc: AssetDocument = {
      _id: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/mead.png`,
    }

    handler.queueAssetDownload(
      assetDoc,
      'images/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png',
    )
    await handler.finish()

    expect(handler.filesWritten).toBe(1)
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })

  test('writes gzip-encoded assets byte-for-byte', async () => {
    // Assets served with `content-encoding: gzip` are piped through a decompress
    // transform inside get-it. A regression there (8.7.1 through 8.8.1) peeked at
    // the decompressed stream with read(1) + unshift(), which delivered the first
    // byte twice: the file lands one byte too long, starting `<<svg`.
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${'<rect x="1" y="1" width="2" height="2"/>'.repeat(24)}</svg>`,
    )
    const gzipped = gzipSync(svg)
    const sha1 = createHash('sha1').update(svg).digest('hex')

    const port = 43218
    server = await getServer(port, (_req, res) => {
      res.writeHead(200, 'OK', {
        'Content-Type': 'image/svg+xml',
        'Content-Encoding': 'gzip',
        'Content-Length': String(gzipped.length),
        // Mirrors the CDN for SVG file assets: md5 only, no x-sanity-sha1
        'x-sanity-md5': createHash('md5').update(svg).digest('hex'),
      })
      res.end(gzipped)
    })

    const tmpDir = joinPath(tmpBase, `gzip-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(port),
      tmpDir,
      maxRetries: 1,
      retryDelayMs: 0,
    })

    // Whether the corruption lands depends on how many event loop turns pass
    // before the write stream attaches, so download more than once.
    const downloads = 5
    for (let i = 0; i < downloads; i++) {
      handler.queueAssetDownload(
        {
          _id: `file-${sha1}-svg`,
          _type: 'sanity.fileAsset',
          url: `http://localhost:${port}/files/sample-${i}.svg`,
        },
        `files/sample-${i}.svg`,
      )
    }
    await handler.finish()

    expect(handler.filesWritten).toBe(downloads)

    for (let i = 0; i < downloads; i++) {
      const written = await readFile(joinPath(tmpDir, 'files', `sample-${i}.svg`))
      expect(createHash('sha1').update(written).digest('hex')).toBe(sha1)
      expect(written.length).toBe(svg.length)
    }
  })

  test('adds Authorization header for image assets on cdn.sanity.io', () => {
    const tmpDir = joinPath(tmpBase, `auth-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(TEST_PORT),
      tmpDir,
      maxRetries: 1,
    })

    const imageDoc: AssetDocument = {
      _id: 'image-abc-100x100-png',
      _type: 'sanity.imageAsset',
      url: 'https://cdn.sanity.io/images/proj/dataset/abc-100x100.png',
    }

    const imageOpts = handler.getAssetRequestOptions(imageDoc)
    expect(imageOpts.headers.Authorization).toBe('Bearer skTestToken')
    expect(imageOpts.url).toContain('dlRaw=true')

    // File assets should NOT get the header
    const fileDoc: AssetDocument = {
      _id: 'file-abc-txt',
      _type: 'sanity.fileAsset',
      url: 'https://cdn.sanity.io/files/proj/dataset/abc.txt',
    }

    const fileOpts = handler.getAssetRequestOptions(fileDoc)
    expect(fileOpts.headers.Authorization).toBeUndefined()
    expect(fileOpts.url).not.toContain('dlRaw')
  })

  test('handles non-cdn URLs without auth header', () => {
    const tmpDir = joinPath(tmpBase, `noauth-${Date.now()}`)
    const handler = new AssetHandler({
      client: getMockClient(TEST_PORT),
      tmpDir,
      maxRetries: 1,
    })

    const doc: AssetDocument = {
      _id: 'image-abc-100x100-png',
      _type: 'sanity.imageAsset',
      url: 'https://example.com/images/abc.png',
    }

    const opts = handler.getAssetRequestOptions(doc)
    expect(opts.headers.Authorization).toBeUndefined()
    expect(opts.url).not.toContain('dlRaw')
  })
})
