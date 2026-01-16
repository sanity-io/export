import {describe, expect, test, beforeAll, afterAll} from 'vitest'
import {mkdtempSync, writeFileSync, rmSync, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {create as createTar} from 'tar'

import {detectCorruption, scanNdjsonFile, scanDirectory} from '../src/detectCorruption.js'

describe('detectCorruption', () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'detect-corrupt-test-'))
  })

  afterAll(() => {
    rmSync(tempDir, {recursive: true, force: true})
  })

  describe('scanNdjsonFile', () => {
    test('detects no corruption in clean NDJSON', async () => {
      const filePath = join(tempDir, 'clean.ndjson')
      const content = [
        '{"_id":"doc1","title":"Hello World"}',
        '{"_id":"doc2","title":"日本語テスト"}',
        '{"_id":"doc3","title":"Emoji test 🎉"}',
      ].join('\n')
      writeFileSync(filePath, content, 'utf8')

      const result = await scanNdjsonFile(filePath)

      expect(result.corrupted).toBe(false)
      expect(result.files.size).toBe(0)
      expect(result.totalCorruptedLines).toBe(0)
    })

    test('detects corruption from replacement characters', async () => {
      const filePath = join(tempDir, 'corrupt.ndjson')
      // Simulate corruption: replacement character where multi-byte char should be
      const content = [
        '{"_id":"doc1","title":"Hello World"}',
        '{"_id":"doc2","title":"日\uFFFD語テスト"}', // Corrupted: 本 replaced with U+FFFD
        '{"_id":"doc3","title":"Valid"}',
      ].join('\n')
      writeFileSync(filePath, content, 'utf8')

      const result = await scanNdjsonFile(filePath)

      expect(result.corrupted).toBe(true)
      expect(result.files.size).toBe(1)
      expect(result.totalCorruptedLines).toBe(1)

      const corruptions = result.files.get(filePath)
      expect(corruptions).toBeDefined()
      expect(corruptions).toHaveLength(1)
      expect(corruptions?.[0]?.line).toBe(2)
      expect(corruptions?.[0]?.count).toBe(1)
    })

    test('detects multiple corruptions on same line', async () => {
      const filePath = join(tempDir, 'multi-corrupt.ndjson')
      // Multiple replacement characters
      const content = '{"_id":"doc1","title":"日\uFFFD語\uFFFDスト"}\n'
      writeFileSync(filePath, content, 'utf8')

      const result = await scanNdjsonFile(filePath)

      expect(result.corrupted).toBe(true)
      const corruptions = result.files.get(filePath)
      expect(corruptions).toBeDefined()
      expect(corruptions?.[0]?.count).toBe(2)
    })

    test('detects corruptions across multiple lines', async () => {
      const filePath = join(tempDir, 'multi-line-corrupt.ndjson')
      const content = [
        '{"_id":"doc1","title":"Corrupt\uFFFD here"}',
        '{"_id":"doc2","title":"Valid line"}',
        '{"_id":"doc3","title":"Also \uFFFD corrupt"}',
      ].join('\n')
      writeFileSync(filePath, content, 'utf8')

      const result = await scanNdjsonFile(filePath)

      expect(result.corrupted).toBe(true)
      expect(result.totalCorruptedLines).toBe(2)
      const corruptions = result.files.get(filePath)
      expect(corruptions).toHaveLength(2)
      expect(corruptions?.[0]?.line).toBe(1)
      expect(corruptions?.[1]?.line).toBe(3)
    })
  })

  describe('detectCorruption with tar.gz', () => {
    test('detects no corruption in clean tar.gz', async () => {
      const tarPath = join(tempDir, 'clean.tar.gz')
      const dataContent = [
        '{"_id":"doc1","title":"Hello World"}',
        '{"_id":"doc2","title":"日本語テスト"}',
      ].join('\n')

      // Create tar.gz with data.ndjson
      const contentDir = join(tempDir, 'clean-content')
      const contentPath = join(contentDir, 'data.ndjson')
            mkdirSync(contentDir, {recursive: true})
      writeFileSync(contentPath, dataContent, 'utf8')

      await createTar(
        {
          gzip: true,
          file: tarPath,
          cwd: tempDir,
        },
        ['clean-content'],
      )

      const result = await detectCorruption(tarPath)

      expect(result.corrupted).toBe(false)
      expect(result.files.size).toBe(0)
    })

    test('detects corruption in tar.gz data.ndjson', async () => {
      const tarPath = join(tempDir, 'corrupt.tar.gz')
      const dataContent = [
        '{"_id":"doc1","title":"Hello World"}',
        '{"_id":"doc2","title":"Corrupt\uFFFD here"}',
      ].join('\n')

      // Create tar.gz with corrupted data.ndjson
      const contentDir = join(tempDir, 'corrupt-content')
      const contentPath = join(contentDir, 'data.ndjson')
            mkdirSync(contentDir, {recursive: true})
      writeFileSync(contentPath, dataContent, 'utf8')

      await createTar(
        {
          gzip: true,
          file: tarPath,
          cwd: tempDir,
        },
        ['corrupt-content'],
      )

      const result = await detectCorruption(tarPath)

      expect(result.corrupted).toBe(true)
      expect(result.totalCorruptedLines).toBe(1)
      // The file path in the tar will be 'corrupt-content/data.ndjson'
      expect(result.files.size).toBe(1)
      const entries = Array.from(result.files.entries())
      expect(entries[0][0]).toContain('data.ndjson')
    })

    test('detects file type by extension', async () => {
      const ndjsonPath = join(tempDir, 'test.ndjson')
      const tgzPath = join(tempDir, 'test.tgz')

      // Create clean ndjson
      writeFileSync(ndjsonPath, '{"_id":"doc1"}\n', 'utf8')

      // detectCorruption should handle .ndjson files
      const ndjsonResult = await detectCorruption(ndjsonPath)
      expect(ndjsonResult.corrupted).toBe(false)

      // Create a tgz file
      const contentDir = join(tempDir, 'tgz-content')
      const contentPath = join(contentDir, 'data.ndjson')
            mkdirSync(contentDir, {recursive: true})
      writeFileSync(contentPath, '{"_id":"doc1"}\n', 'utf8')

      await createTar(
        {
          gzip: true,
          file: tgzPath,
          cwd: tempDir,
        },
        ['tgz-content'],
      )

      // detectCorruption should handle .tgz files
      const tgzResult = await detectCorruption(tgzPath)
      expect(tgzResult.corrupted).toBe(false)
    })
  })

  describe('scanDirectory', () => {
    test('scans data.ndjson in directory', async () => {
      const dir = join(tempDir, 'dir-with-data')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'data.ndjson'), '{"_id":"doc1"}\n', 'utf8')

      const result = await scanDirectory(dir)

      expect(result.corrupted).toBe(false)
      expect(result.files.size).toBe(0)
    })

    test('scans assets.json in directory', async () => {
      const dir = join(tempDir, 'dir-with-assets')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'assets.json'), '{"asset1":{"_id":"a1"}}\n', 'utf8')

      const result = await scanDirectory(dir)

      expect(result.corrupted).toBe(false)
      expect(result.files.size).toBe(0)
    })

    test('scans both data.ndjson and assets.json', async () => {
      const dir = join(tempDir, 'dir-with-both')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'data.ndjson'), '{"_id":"doc1"}\n', 'utf8')
      writeFileSync(join(dir, 'assets.json'), '{"asset1":{"_id":"a1"}}\n', 'utf8')

      const result = await scanDirectory(dir)

      expect(result.corrupted).toBe(false)
    })

    test('detects corruption in directory files', async () => {
      const dir = join(tempDir, 'dir-corrupt')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'data.ndjson'), '{"_id":"doc1","title":"Corrupt\uFFFD"}\n', 'utf8')

      const result = await scanDirectory(dir)

      expect(result.corrupted).toBe(true)
      expect(result.totalCorruptedLines).toBe(1)
    })

    test('throws error when no target files found', async () => {
      const dir = join(tempDir, 'empty-dir')
      mkdirSync(dir, {recursive: true})

      await expect(scanDirectory(dir)).rejects.toThrow(
        /No data\.ndjson or assets\.json found/,
      )
    })

    test('detectCorruption handles directory input', async () => {
      const dir = join(tempDir, 'dir-via-detect')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'data.ndjson'), '{"_id":"doc1"}\n', 'utf8')

      const result = await detectCorruption(dir)

      expect(result.corrupted).toBe(false)
    })
  })
})
