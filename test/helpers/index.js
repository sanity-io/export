import fs from 'node:fs'
import {readdir, readFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {dirname, join as joinPath} from 'node:path'
import {Readable} from 'node:stream'
import * as tar from 'tar'
import {expect, vi} from 'vitest'

import {AssetHandler} from '../../src/AssetHandler.js'

const getMockClient = () => ({
  config: () => ({projectId: '__fixtures__', dataset: '__test__'}),
  fetch: (query, params) =>
    query.endsWith('._type') ? `sanity.imageAsset` : `http://localhost:32323/${params.id}.jpg`,
})

const getMockArchive = () => ({append: vi.fn(), abort: vi.fn()})

const getMockQueue = () => {
  const ops = []
  return {
    add: (task) => ops.push(task),
    __size: () => ops.length,
    __run: () => ops.forEach((fn) => fn()),
  }
}

const arrayToStream = (docs) => Readable.from([docs.map((doc) => JSON.stringify(doc)).join('\n')])

const ndjsonToArray = (ndjson) =>
  ndjson
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const getAssetHandler = () =>
  new AssetHandler({
    prefix: 'test',
    client: getMockClient(),
    tmpDir: joinPath(os.tmpdir(), 'asset-handler-tests', `${Date.now()}`),
  })

const untarExportedFile = async (outDir, filepath) => {
  await tar.x({C: outDir, f: filepath})

  // Attempt to find the export directory within the untarred files
  const exportDir = fs.readdirSync(outDir).find((dir) => dir.includes('-export-'))
  if (!exportDir) {
    throw new Error(`Expected export dir not found in ${outDir}`)
  }

  return path.join(outDir, exportDir)
}

async function assertContents(fileName, content) {
  const cwd = dirname(fileName)
  await tar.x({
    file: fileName,
    gzip: true,
    cwd,
  })

  const [dir] = (await readdir(cwd)).filter((entry) => entry !== 'out.tar.gz')
  const baseDir = joinPath(cwd, dir)
  const assetsMeta =
    content.images || content.files ? await readJson(joinPath(baseDir, 'assets.json')) : undefined

  if (content.images) {
    const expectedImages = Object.keys(content.images)
    const actualImages = await readdir(joinPath(baseDir, 'images')).catch((err) => {
      if (err.code === 'ENOENT') {
        return []
      }

      throw err
    })

    for (const image of expectedImages) {
      expect(actualImages).toContain(image)

      const metaKey = `image-${image.slice(0, 40)}`
      const expectedMeta = content.images[metaKey] || {}
      if (Object.keys(expectedMeta).length > 0) {
        expect(assetsMeta[image]).toMatchObject(expectedMeta)
      }
    }

    expect(actualImages.length).toBe(expectedImages.length)
  }

  if (content.files) {
    const expectedFiles = Object.keys(content.files)
    const actualFiles = await readdir(joinPath(baseDir, 'files')).catch((err) => {
      if (err.code === 'ENOENT') {
        return []
      }

      throw err
    })
    for (const file of expectedFiles) {
      expect(actualFiles).toContain(file)

      const metaKey = `file-${file.slice(0, 40)}`
      const expectedMeta = content.files[metaKey] || {}
      if (Object.keys(expectedMeta).length > 0) {
        expect(assetsMeta[file]).toMatchObject(expectedMeta)
      }
    }

    expect(actualFiles.length).toBe(expectedFiles.length)
  }

  if (content.documents) {
    const expectedDocs = content.documents
    const actualDocs = new Map()

    ;(await readFile(joinPath(baseDir, 'data.ndjson'), 'utf-8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((doc) => actualDocs.set(doc._id, doc))

    for (const expectedDoc of expectedDocs) {
      const actualDoc = actualDocs.get(expectedDoc._id)
      expect(actualDoc).toMatchObject(expectedDoc)
    }

    expect(actualDocs.size).toBe(expectedDocs.length)
  }
}

async function readJson(filePath) {
  return readFile(filePath, {encoding: 'utf8'})
    .then((content) => JSON.parse(content))
    .catch((err) => {
      console.error(`Failed to read JSON file at ${filePath}`)
      throw err
    })
}

export {
  arrayToStream,
  assertContents,
  getAssetHandler,
  getMockArchive,
  getMockClient,
  getMockQueue,
  ndjsonToArray,
  untarExportedFile,
}
