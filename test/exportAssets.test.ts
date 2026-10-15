import {createReadStream} from 'node:fs'
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Writable} from 'node:stream'

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {exportDataset} from '../src/export.js'
import type {ExportOptions, SanityDocument} from '../src/types.js'
import {ndjsonToArray, untarExportedFile} from './helpers/index.js'
import {getServer, type ServerHandle} from './helpers/server.js'

const imageId = 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png'
const fileId = 'file-497d1ba975eae4283a4e8906e3cb434110361f64-txt'
const image = {_type: 'image', asset: {_type: 'reference', _ref: imageId}, alt: 'A shared image'}
const file = {_type: 'file', asset: {_type: 'reference', _ref: fileId}}
const posts = [
  {
    _id: 'post-one',
    _type: 'post',
    image,
    nested: [{file}],
    category: {_type: 'reference', _ref: 'category'},
  },
  {_id: 'post-two', _type: 'post', image},
]

interface Scenario {
  documents?: SanityDocument[]
  assetDocuments?: SanityDocument[]
  stallImage?: boolean
  lookupFailOnce?: boolean
  unicodeMetadata?: boolean
  missing?: string
  noUrl?: boolean
  lookupStatus?: number
  malformedLookup?: boolean
  downloadStatus?: number
  failOnce?: boolean
  stall?: boolean
  brokenCursor?: boolean
}

describe('referenced asset exports', () => {
  let directory: string
  let server: ServerHandle
  let requests: string[]
  let lookups: string[][]
  let attempts: number

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'export-asset-scenario-'))
    requests = []
    lookups = []
    attempts = 0
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await server?.close()
    await rm(directory, {recursive: true, force: true})
  })

  async function setup(scenario: Scenario = {}) {
    server = await getServer((req, res) => {
      const url = new URL(req.url!, `http://127.0.0.1:${server.port}`)
      requests.push(url.pathname)
      if (url.pathname === '/image' || url.pathname === '/file') {
        attempts++
        if (scenario.stall || (scenario.stallImage && url.pathname === '/image')) {
          res.writeHead(200)
          res.write('incomplete')
          return
        }
        const status = scenario.failOnce && attempts > 1 ? 200 : (scenario.downloadStatus ?? 200)
        if (status !== 200) {
          res.writeHead(status)
          res.end('Asset unavailable')
          return
        }
        createReadStream(
          join(
            import.meta.dirname,
            'fixtures',
            url.pathname === '/image' ? 'mead.png' : 'coffee.txt',
          ),
        ).pipe(res)
        return
      }
      const assets = scenario.assetDocuments?.map((doc) => ({
        ...doc,
        url: `${url.origin}/image`,
      })) ?? [
        {
          _id: imageId,
          _type: 'sanity.imageAsset',
          url: scenario.noUrl ? undefined : `${url.origin}/image`,
          title: scenario.unicodeMetadata ? 'Café 🌄' : 'Shared image',
          originalFilename: 'mead.png',
        },
        {_id: fileId, _type: 'sanity.fileAsset', url: `${url.origin}/file`, title: 'Attachment'},
      ]
      if (url.pathname.startsWith('/data/doc/')) {
        const ids = decodeURIComponent(url.pathname.split('/').at(-1)!).split(',')
        lookups.push(ids)
        res.writeHead(
          scenario.lookupFailOnce && lookups.length > 1 ? 200 : (scenario.lookupStatus ?? 200),
        )
        const body = scenario.malformedLookup
          ? '{broken'
          : JSON.stringify({
              documents: assets.filter(
                (doc) => ids.includes(doc._id) && doc._id !== scenario.missing,
              ),
            })
        if (scenario.unicodeMetadata) {
          const bytes = Buffer.from(body)
          const splitAt = bytes.indexOf(Buffer.from('é')) + 1
          res.write(bytes.subarray(0, splitAt))
          setTimeout(() => res.end(bytes.subarray(splitAt)), 10)
        } else {
          res.end(body)
        }
        return
      }
      if (scenario.brokenCursor && url.searchParams.get('nextCursor')) {
        res.destroy()
        return
      }
      const types = url.searchParams.get('types')?.split(',')
      const documents = [...(scenario.documents ?? posts), ...assets].filter(
        (doc) => !types || types.includes(doc._type),
      )
      res.end(
        documents.map((doc) => JSON.stringify(doc)).join('\n') +
          (scenario.brokenCursor ? '\n{"nextCursor":"next"}' : ''),
      )
    })
    return {
      client: {
        config: () => ({token: 'test-token'}),
        getUrl: (path: string) => `http://127.0.0.1:${server.port}${path}`,
      },
      dataset: 'scenario',
      types: ['post'],
      outputPath: join(directory, 'out.tar.gz'),
      maxAssetRetries: 2,
      maxRetries: 2,
      retryDelayMs: 0,
      readTimeout: 100,
    } satisfies ExportOptions
  }

  test('includes shared and nested assets once with their metadata', async () => {
    const result = await exportDataset(await setup())
    expect(result).toMatchObject({documentCount: 2, assetCount: 2})
    expect(lookups).toEqual([[imageId, fileId]])
    expect(requests.filter((path) => path === '/image')).toHaveLength(1)
    const extracted = await untarExportedFile(directory, result.outputPath)
    expect(JSON.parse(await readFile(join(extracted, 'assets.json'), 'utf8'))).toMatchObject({
      'image-eca53d85ec83704801ead6c8be368fd377f8aaef': {
        title: 'Shared image',
        originalFilename: 'mead.png',
      },
      'file-497d1ba975eae4283a4e8906e3cb434110361f64': {title: 'Attachment'},
    })
    const docs = ndjsonToArray(await readFile(join(extracted, 'data.ndjson')))
    expect(docs[0]).toMatchObject({category: posts[0]!.category, image: {alt: image.alt}})
  })

  test('preserves UTF-8 metadata split across response chunks', async () => {
    const result = await exportDataset(await setup({unicodeMetadata: true}))
    const extracted = await untarExportedFile(directory, result.outputPath)
    const metadata = JSON.parse(await readFile(join(extracted, 'assets.json'), 'utf8'))
    expect(metadata['image-eca53d85ec83704801ead6c8be368fd377f8aaef'].title).toBe('Café 🌄')
  })

  test('does not look up dataset references when exporting a Media Library', async () => {
    const {dataset: _dataset, ...options} = await setup()
    await expect(exportDataset({...options, mediaLibraryId: 'library'})).resolves.toMatchObject({
      documentCount: 2,
      assetCount: 0,
    })
    expect(lookups).toEqual([])
    expect(attempts).toBe(0)
  })

  test('deduplicates referenced assets already selected explicitly', async () => {
    const options = await setup()
    const result = await exportDataset({...options, types: ['post', 'sanity.imageAsset']})
    expect(result.assetCount).toBe(2)
    expect(lookups).toEqual([[fileId]])
    expect(requests.filter((path) => path === '/image')).toHaveLength(1)
  })

  test.each([{malformedLookup: true}, {downloadStatus: 500}, {stall: true}])(
    'fails without replacing existing output: %j',
    async (scenario) => {
      const options = await setup(scenario)
      await writeFile(options.outputPath, 'previous valid export')
      await expect(exportDataset(options)).rejects.toThrow()
      expect(await readFile(options.outputPath, 'utf8')).toBe('previous valid export')
      expect(await readdir(directory)).toEqual(['out.tar.gz'])
    },
  )

  test('skips missing assets and names the referencing document in the warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const options = await setup({missing: imageId})
    const result = await exportDataset(options)
    expect(result).toMatchObject({documentCount: 2, assetCount: 1})
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Asset "${imageId}" referenced by document "post-one"`),
    )
    const extracted = await untarExportedFile(directory, result.outputPath)
    expect(await readdir(join(extracted, 'images'))).toEqual([])
    expect(await readdir(join(extracted, 'files'))).toHaveLength(1)
  })

  test('skips referenced assets without a download URL', async () => {
    const result = await exportDataset(await setup({noUrl: true}))
    expect(result).toMatchObject({documentCount: 2, assetCount: 1})
    const extracted = await untarExportedFile(directory, result.outputPath)
    expect(await readdir(join(extracted, 'images'))).toEqual([])
    expect(await readdir(join(extracted, 'files'))).toHaveLength(1)
  })

  test.each([401, 403, 404])(
    'continues when referenced asset downloads return HTTP %i',
    async (status) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onProgress = vi.fn()
      const result = await exportDataset({...(await setup({downloadStatus: status})), onProgress})
      expect(result).toMatchObject({documentCount: 2, assetCount: 0})
      expect(onProgress).toHaveBeenCalledWith({
        step: 'Downloading assets...',
        current: 2,
        total: 2,
        update: true,
      })
      expect(warn).toHaveBeenCalledWith(expect.any(String), status, imageId)
      expect(warn).toHaveBeenCalledWith(expect.any(String), status, fileId)
      const extracted = await untarExportedFile(directory, result.outputPath)
      expect(await readdir(join(extracted, 'images'))).toEqual([])
      expect(await readdir(join(extracted, 'files'))).toEqual([])
      expect(ndjsonToArray(await readFile(join(extracted, 'data.ndjson')))).toHaveLength(2)
    },
  )

  test.each([401, 403, 404])('continues when asset lookups return HTTP %i', async (status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await exportDataset(await setup({lookupStatus: status}))
    expect(result).toMatchObject({documentCount: 2, assetCount: 0})
    expect(attempts).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.any(String), status, `${imageId}, ${fileId}`)
  })

  test.each([429, 503])('retries transient download HTTP %i', async (status) => {
    const options = await setup({downloadStatus: status, failOnce: true, documents: [posts[1]!]})
    await expect(exportDataset(options)).resolves.toMatchObject({assetCount: 1})
    expect(attempts).toBe(2)
  })

  test.each(['filter', 'transform'])(
    'does not resolve assets removed by %s callback',
    async (callback) => {
      const options = await setup({missing: imageId})
      await exportDataset({
        ...options,
        ...(callback === 'filter'
          ? {filterDocument: () => false}
          : {transformDocument: (doc) => ({_id: doc._id, _type: doc._type})}),
      })
      expect(lookups).toEqual([])
      expect(attempts).toBe(0)
    },
  )

  test('propagates a later cursor request failure', async () => {
    const options = await setup({brokenCursor: true})
    await expect(exportDataset({...options, mode: 'cursor'})).rejects.toThrow()
    expect(await readdir(directory)).toEqual([])
  })

  test('batches asset lookups and downloads each unique asset once', async () => {
    const assets = Array.from({length: 51}, (_, index) => ({
      _id: `image-${index.toString(16).padStart(40, '0')}-1x1-png`,
      _type: 'sanity.imageAsset',
    }))
    const gallery = assets.map((asset) => ({
      _type: 'image',
      asset: {_type: 'reference', _ref: asset._id},
    }))
    const options = await setup({
      assetDocuments: assets,
      documents: [{_id: 'gallery', _type: 'post', images: [...gallery, ...gallery]}],
    })
    await expect(exportDataset(options)).resolves.toMatchObject({assetCount: 51})
    expect(lookups.map((batch) => batch.length)).toEqual([50, 1])
    expect(attempts).toBe(51)
  })

  test('retries transient asset-document lookup failures', async () => {
    const options = await setup({lookupStatus: 503, lookupFailOnce: true})
    await expect(exportDataset(options)).resolves.toMatchObject({assetCount: 2})
    expect(lookups).toHaveLength(2)
  })

  test('aborts another active download when one asset fails', async () => {
    const options = await setup({stallImage: true, downloadStatus: 500})
    const start = Date.now()
    await expect(exportDataset({...options, readTimeout: 30_000})).rejects.toThrow('HTTP 500')
    expect(Date.now() - start).toBeLessThan(2000)
    expect(await readdir(directory)).toEqual([])
  })

  test('does not look up assets from excluded drafts', async () => {
    const options = await setup({missing: imageId, documents: [{...posts[1]!, _id: 'drafts.post'}]})
    await expect(exportDataset({...options, drafts: false})).resolves.toMatchObject({
      documentCount: 0,
      assetCount: 0,
    })
    expect(lookups).toEqual([])
  })

  test('zero retries still attempts the download once', async () => {
    const options = await setup({documents: [posts[1]!]})
    await expect(exportDataset({...options, maxAssetRetries: 0})).resolves.toMatchObject({
      assetCount: 1,
    })
    expect(attempts).toBe(1)
  })

  test('preserves existing local file pointers without adding a new validation failure', async () => {
    const options = await setup({
      documents: [
        {
          _id: 'broken-post',
          _type: 'post',
          image: {_type: 'image', _sanityAsset: 'image@file://./images/missing.png'},
        },
      ],
    })
    const result = await exportDataset(options)
    const extracted = await untarExportedFile(directory, result.outputPath)
    expect(ndjsonToArray(await readFile(join(extracted, 'data.ndjson')))).toEqual([
      {
        _id: 'broken-post',
        _type: 'post',
        image: {_type: 'image', _sanityAsset: 'image@file://./images/missing.png'},
      },
    ])
    expect(lookups).toEqual([])
  })

  test('handles destination stream failure without hanging', async () => {
    const options = await setup()
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('Disk full'))
      },
    })
    await expect(exportDataset({...options, outputPath: output})).rejects.toThrow('Disk full')
  })
})
