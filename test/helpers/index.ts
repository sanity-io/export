import {readdir, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join as joinPath} from 'node:path'

import type {SanityClient} from '@sanity/client'
import {x as extract} from 'tar'
import {expect} from 'vitest'

import {AssetHandler} from '../../src/AssetHandler.js'
import type {SanityDocument} from '../../src/types.js'

interface MockClient {
  config: () => {projectId: string; dataset: string}
  fetch: (query: string, params: {id: string}) => string
}

const getMockClient = (): MockClient => ({
  config: () => ({projectId: '__fixtures__', dataset: '__test__'}),
  fetch: (query: string, params: {id: string}) =>
    query.endsWith('._type') ? `sanity.imageAsset` : `http://localhost:32323/${params.id}.jpg`,
})

export function ndjsonToArray(ndjson: Buffer | string): unknown[] {
  return ndjson
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
}

export function getAssetHandler(): AssetHandler {
  return new AssetHandler({
    prefix: 'test',
    client: getMockClient() as unknown as SanityClient,
    tmpDir: joinPath(tmpdir(), 'asset-handler-tests', `${Date.now()}`),
  })
}

export async function untarExportedFile(outDir: string, filepath: string): Promise<string> {
  await extract({C: outDir, f: filepath})

  // Attempt to find the export directory within the untarred files
  const exportDir = (await readdir(outDir)).find((dir) => dir.includes('-export-'))
  if (!exportDir) {
    throw new Error(`Expected export dir not found in ${outDir}`)
  }

  return joinPath(outDir, exportDir)
}

interface ExpectedAssetMeta {
  [key: string]: unknown
}

interface ExpectedContent {
  images?: Record<string, ExpectedAssetMeta>
  files?: Record<string, ExpectedAssetMeta>
  documents?: Array<Partial<SanityDocument> & {_id: string}>
}

interface AssetMetaJson {
  [key: string]: unknown
}

export async function assertContents(fileName: string, content: ExpectedContent): Promise<void> {
  const cwd = dirname(fileName)
  await extract({
    file: fileName,
    gzip: true,
    cwd,
  })

  const [dir] = (await readdir(cwd)).filter((entry) => entry !== 'out.tar.gz')
  if (!dir) {
    throw new Error('No export directory found')
  }
  const baseDir = joinPath(cwd, dir)
  const assetsMeta: AssetMetaJson | undefined =
    content.images || content.files ? await readJson(joinPath(baseDir, 'assets.json')) : undefined

  if (content.images) {
    const expectedImages = Object.keys(content.images)
    const actualImages = await readdir(joinPath(baseDir, 'images')).catch((err: unknown) => {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
        return []
      }

      throw err
    })

    for (const image of expectedImages) {
      expect(actualImages).toContain(image)

      const metaKey = `image-${image.slice(0, 40)}`
      const expectedMeta = content.images[metaKey] ?? {}
      if (Object.keys(expectedMeta).length > 0 && assetsMeta) {
        expect(assetsMeta[image]).toMatchObject(expectedMeta)
      }
    }

    expect(actualImages.length).toBe(expectedImages.length)
  }

  if (content.files) {
    const expectedFiles = Object.keys(content.files)
    const actualFiles = await readdir(joinPath(baseDir, 'files')).catch((err: unknown) => {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
        return []
      }

      throw err
    })
    for (const file of expectedFiles) {
      expect(actualFiles).toContain(file)

      const metaKey = `file-${file.slice(0, 40)}`
      const expectedMeta = content.files[metaKey] ?? {}
      if (Object.keys(expectedMeta).length > 0 && assetsMeta) {
        expect(assetsMeta[file]).toMatchObject(expectedMeta)
      }
    }

    expect(actualFiles.length).toBe(expectedFiles.length)
  }

  if (content.documents) {
    const expectedDocs = content.documents
    const actualDocs = new Map<string, SanityDocument>()

    ;(await readFile(joinPath(baseDir, 'data.ndjson'), 'utf-8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SanityDocument)
      .forEach((doc) => actualDocs.set(doc._id, doc))

    for (const expectedDoc of expectedDocs) {
      const actualDoc = actualDocs.get(expectedDoc._id)
      expect(actualDoc).toMatchObject(expectedDoc)
    }

    expect(actualDocs.size).toBe(expectedDocs.length)
  }
}

async function readJson(filePath: string): Promise<AssetMetaJson> {
  return readFile(filePath, {encoding: 'utf8'})
    .then((content) => JSON.parse(content) as AssetMetaJson)
    .catch((err: unknown) => {
      console.error(`Failed to read JSON file at ${filePath}`)
      throw err
    })
}
