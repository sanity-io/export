import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join as joinPath} from 'node:path'
import {createWriteStream} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'
import {list} from 'tar'

import {createTarArchive} from '../src/util/tarArchive.js'

interface ListedEntry {
  path: string
  type: string
  mode: number | undefined
  uid: number | undefined
  gid: number | undefined
  size: number
}

/**
 * Reads the archive back with node-tar rather than modern-tar, so that these tests check
 * the bytes against an independent implementation instead of just round-tripping.
 */
const listArchive = async (file: string): Promise<ListedEntry[]> => {
  const entries: ListedEntry[] = []
  await list({
    file,
    onReadEntry: (entry) => {
      entries.push({
        path: entry.path,
        type: entry.type,
        mode: entry.mode,
        uid: entry.uid,
        gid: entry.gid,
        size: entry.size,
      })
      entry.resume()
    },
  })
  return entries
}

describe('createTarArchive', () => {
  let tmpBase: string

  beforeAll(async () => {
    tmpBase = await mkdtemp(joinPath(tmpdir(), 'tar-archive-test-'))
  })

  afterAll(async () => {
    await rm(tmpBase, {recursive: true, force: true})
  })

  const stage = async (name: string): Promise<{dir: string; out: string}> => {
    const dir = joinPath(tmpBase, name)
    await mkdir(dir, {recursive: true})
    return {dir, out: joinPath(tmpBase, `${name}.tar`)}
  }

  test('writes files and directories with fixed, owner-less headers', async () => {
    const {dir, out} = await stage('headers')
    await writeFile(joinPath(dir, 'data.ndjson'), '{"_id":"a"}\n')
    await mkdir(joinPath(dir, 'images'), {recursive: true})
    await writeFile(joinPath(dir, 'images', 'a.png'), 'png')

    const archive = createTarArchive()
    const done = pipeline(archive.stream, createWriteStream(out))
    await archive.addFile(joinPath(dir, 'data.ndjson'), 'export/data.ndjson')
    await archive.addDirectory(joinPath(dir, 'images'), 'export/images')
    archive.finalize()
    await done

    expect(await listArchive(out)).toEqual([
      {path: 'export/data.ndjson', type: 'File', mode: 0o644, uid: 0, gid: 0, size: 12},
      {path: 'export/images/', type: 'Directory', mode: 0o755, uid: 0, gid: 0, size: 0},
      {path: 'export/images/a.png', type: 'File', mode: 0o644, uid: 0, gid: 0, size: 3},
    ])
  })

  test('preserves entry paths longer than the 100 character ustar limit', async () => {
    const {dir, out} = await stage('longpaths')
    await mkdir(joinPath(dir, 'images'), {recursive: true})
    // A real export nests a content-addressed asset name under a dated prefix, which
    // together run past the 100 characters a ustar name field holds
    const assetName = 'eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png'
    const prefix = 'my-production-dataset-export-2026-09-03t16-48-32-302z'
    await writeFile(joinPath(dir, 'images', assetName), 'png bytes')

    const archive = createTarArchive()
    const done = pipeline(archive.stream, createWriteStream(out))
    await archive.addDirectory(joinPath(dir, 'images'), `${prefix}/images`)
    archive.finalize()
    await done

    const expectedPath = `${prefix}/images/${assetName}`
    expect(expectedPath.length).toBeGreaterThan(100)
    expect((await listArchive(out)).map((entry) => entry.path)).toEqual([
      `${prefix}/images/`,
      expectedPath,
    ])
  })

  test('includes empty directories', async () => {
    const {dir, out} = await stage('empty')
    await mkdir(joinPath(dir, 'files'), {recursive: true})

    const archive = createTarArchive()
    const done = pipeline(archive.stream, createWriteStream(out))
    await archive.addDirectory(joinPath(dir, 'files'), 'export/files')
    archive.finalize()
    await done

    expect((await listArchive(out)).map((entry) => entry.path)).toEqual(['export/files/'])
  })

  test('packs nested directories in a stable order', async () => {
    const {dir, out} = await stage('ordering')
    await mkdir(joinPath(dir, 'assets', 'nested'), {recursive: true})
    for (const name of ['c.bin', 'a.bin', 'b.bin']) {
      await writeFile(joinPath(dir, 'assets', name), name)
    }
    await writeFile(joinPath(dir, 'assets', 'nested', 'deep.bin'), 'deep')

    const archive = createTarArchive()
    const done = pipeline(archive.stream, createWriteStream(out))
    await archive.addDirectory(joinPath(dir, 'assets'), 'export/assets')
    archive.finalize()
    await done

    expect((await listArchive(out)).map((entry) => entry.path)).toEqual([
      'export/assets/',
      'export/assets/a.bin',
      'export/assets/b.bin',
      'export/assets/c.bin',
      'export/assets/nested/',
      'export/assets/nested/deep.bin',
    ])
  })

  test('abort makes the archive stream fail', async () => {
    const {dir, out} = await stage('abort')
    await writeFile(joinPath(dir, 'data.ndjson'), '{"_id":"a"}\n')

    const archive = createTarArchive()
    const done = pipeline(archive.stream, createWriteStream(out))
    await archive.addFile(joinPath(dir, 'data.ndjson'), 'export/data.ndjson')
    archive.abort(new Error('export blew up'))

    await expect(done).rejects.toThrow('export blew up')
  })
})
