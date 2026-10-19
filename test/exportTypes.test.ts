import {createReadStream} from 'node:fs'
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {exportDataset} from '../src/export.js'
import {ndjsonToArray, untarExportedFile} from './helpers/index.js'
import {getServer, type ServerHandle} from './helpers/server.js'

const imageId = 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png'
const fileId = 'file-497d1ba975eae4283a4e8906e3cb434110361f64-txt'
const imageFilename = 'eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png'
const fileFilename = '497d1ba975eae4283a4e8906e3cb434110361f64.txt'
const image = {
  _type: 'image',
  asset: {_type: 'reference', _ref: imageId},
  alt: 'A logo',
  crop: {_type: 'sanity.imageCrop', top: 0.1, bottom: 0, left: 0, right: 0},
}
const file = {_type: 'file', asset: {_type: 'reference', _ref: fileId}}
const category = {_type: 'reference', _ref: 'category'}
const article = {_id: 'article', _type: 'article', image, attachments: [{file}], category}

describe.each(['stream', 'cursor'] as const)('typed exports in %s mode', (mode) => {
  let directory: string
  let server: ServerHandle | undefined

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sanity-export-types-'))
  })

  afterEach(async () => {
    await server?.close()
    await rm(directory, {recursive: true, force: true})
  })

  test.each([
    {types: ['article'], imageIncluded: true, fileIncluded: true},
    {types: ['article', 'sanity.imageAsset'], imageIncluded: true, fileIncluded: true},
    {types: ['article', 'sanity.fileAsset'], imageIncluded: true, fileIncluded: true},
    {
      types: ['article', 'sanity.imageAsset', 'sanity.fileAsset'],
      imageIncluded: true,
      fileIncluded: true,
    },
    {types: [], imageIncluded: true, fileIncluded: true},
    {types: undefined, imageIncluded: true, fileIncluded: true},
  ])('archives match asset references for $types', async ({types, imageIncluded, fileIncluded}) => {
    const requests: string[] = []
    server = await getServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${server!.port}`)
      requests.push(url.pathname)
      if (url.pathname === '/image' || url.pathname === '/file') {
        const fixture = url.pathname === '/image' ? 'mead.png' : 'coffee.txt'
        createReadStream(join(import.meta.dirname, 'fixtures', fixture)).pipe(res)
        return
      }

      const requestedTypes = url.searchParams.get('types')?.split(',')
      const documents = [
        article,
        {_id: imageId, _type: 'sanity.imageAsset', url: `${url.origin}/image`},
        {_id: fileId, _type: 'sanity.fileAsset', url: `${url.origin}/file`},
        {_id: 'category', _type: 'category'},
      ]
      if (url.pathname.startsWith('/data/doc/')) {
        const ids = decodeURIComponent(url.pathname.split('/').at(-1)!).split(',')
        res.end(JSON.stringify({documents: documents.filter((doc) => ids.includes(doc._id))}))
        return
      }
      const selected = documents.filter(
        (doc) => !requestedTypes || requestedTypes.includes(doc._type),
      )
      res.end(selected.map((doc) => JSON.stringify(doc)).join('\n'))
    })

    const result = await exportDataset({
      client: {
        config: () => ({token: 'test'}),
        getUrl: (path) => `http://localhost:${server!.port}${path}`,
      },
      dataset: `typed-${mode}`,
      types,
      mode,
      outputPath: join(directory, 'out.tar.gz'),
    })
    const extracted = await untarExportedFile(directory, result.outputPath)
    const documents = ndjsonToArray(await readFile(join(extracted, 'data.ndjson')))
    const expectedImage = imageIncluded
      ? {
          _type: image._type,
          alt: image.alt,
          crop: image.crop,
          _sanityAsset: `image@file://./images/${imageFilename}`,
        }
      : image
    const expectedFile = fileIncluded
      ? {_type: file._type, _sanityAsset: `file@file://./files/${fileFilename}`}
      : file
    expect(documents[0]).toEqual({
      ...article,
      image: expectedImage,
      attachments: [{file: expectedFile}],
    })
    expect(documents).toHaveLength(types?.length ? 1 : 2)
    expect(result.assetCount).toBe(Number(imageIncluded) + Number(fileIncluded))
    expect(await readdir(join(extracted, 'images'))).toEqual(imageIncluded ? [imageFilename] : [])
    expect(await readdir(join(extracted, 'files'))).toEqual(fileIncluded ? [fileFilename] : [])
    expect(requests.filter((path) => path === '/image')).toHaveLength(Number(imageIncluded))
    expect(requests.filter((path) => path === '/file')).toHaveLength(Number(fileIncluded))
    if (imageIncluded) {
      expect(await readFile(join(extracted, 'images', imageFilename))).toEqual(
        await readFile(join(import.meta.dirname, 'fixtures', 'mead.png')),
      )
    }
    if (fileIncluded) {
      expect(await readFile(join(extracted, 'files', fileFilename))).toEqual(
        await readFile(join(import.meta.dirname, 'fixtures', 'coffee.txt')),
      )
    }
  })

  test.each([
    {raw: true, assets: true},
    {raw: true, assets: false},
    {raw: false, assets: false},
  ])('respects raw=$raw and assets=$assets', async ({raw, assets}) => {
    server = await getServer((_req, res) => res.end(JSON.stringify(article)))
    const result = await exportDataset({
      client: {
        config: () => ({token: 'test'}),
        getUrl: (path) => `http://localhost:${server!.port}${path}`,
      },
      dataset: `typed-${mode}`,
      types: ['article'],
      mode,
      raw,
      assets,
      outputPath: join(directory, 'out.tar.gz'),
    })
    const extracted = await untarExportedFile(directory, result.outputPath)
    expect(ndjsonToArray(await readFile(join(extracted, 'data.ndjson')))).toEqual([
      raw ? article : {_id: 'article', _type: 'article', attachments: [{}], category},
    ])
    expect(result.assetCount).toBe(0)
    expect(await readdir(join(extracted, 'images'))).toEqual([])
    expect(await readdir(join(extracted, 'files'))).toEqual([])
  })
})
