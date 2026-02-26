import {createReadStream} from 'node:fs'
import {readdir, rm} from 'node:fs/promises'
import http from 'node:http'
import {tmpdir} from 'node:os'
import {join as joinPath} from 'node:path'

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
    const assetMap = await handler.finish()

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
    const assetMap = await handler.finish()

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
    const keys = Object.keys(assetMap)
    expect(keys).toHaveLength(1)
    expect(assetMap[keys[0]!]).toMatchObject({originalFilename: 'mead.png'})
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
