/*
This file contains integration tests for the exportDataset function and are based on fixtures
  in the fixtures directory. Each fixture contains a set of test cases that are run against the
  exportDataset function and a mocked backend API with disabled network requests.
*/

import {mkdir, mkdtemp, readdir, readFile, stat} from 'node:fs/promises'
import {basename, join as joinPath} from 'node:path'

import {createClient} from '@sanity/client'
import nock from 'nock'
import {rimraf} from 'rimraf'
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'

import {exportDataset} from '../src/export.js'
import {ndjsonToArray, untarExportedFile} from './helpers/index.js'
import {newTestRunId, withTmpDir} from './helpers/suite.js'

const fixturesDirectory = joinPath(import.meta.dirname, 'fixtures')

const expectExportSuccess = async (exportDir, exportFilePath) => {
  const stats = await stat(exportFilePath)
  expect(stats.size).toBeGreaterThan(0)

  const extractedDir = await untarExportedFile(exportDir, exportFilePath)

  const dataFile = await readFile(`${extractedDir}/data.ndjson`, 'utf8')
  expect(ndjsonToArray(dataFile)).toMatchSnapshot()

  const assetsFile = await readFile(`${extractedDir}/assets.json`, 'utf8')
  expect(JSON.parse(assetsFile)).toMatchSnapshot()
}

const setupNock = async ({url, query = {}, response}) => {
  nock.disableNetConnect()

  const {origin, pathname} = URL.parse(url)

  const body =
    response.bodyFromFile === true
      ? await readFile(joinPath(fixturesDirectory, response.bodyFromFile))
      : response.body

  return nock(origin)
    .get(pathname || '/')
    .query(query)
    .reply(response.code ? response.code : 200, body)
}

describe('export integration tests', async () => {
  let testRunPath
  beforeAll(async () => {
    await mkdir(joinPath(import.meta.dirname, 'testruns'), {recursive: true})
    testRunPath = await mkdtemp(
      joinPath(import.meta.dirname, 'testruns', `testrun_${newTestRunId()}`),
    )
  })

  afterAll(async () => {
    nock.cleanAll()
    if (process.env.DO_NOT_DELETE !== 'true') {
      await rimraf(testRunPath)
    }
  })

  const testFiles = (await readdir(fixturesDirectory)).filter((file) => file.endsWith('.json'))
  const testCases = await Promise.all(
    testFiles.map(async (file) => {
      const fullPath = joinPath(fixturesDirectory, file)
      const fileContents = await readFile(fullPath, 'utf8')
      const testData = JSON.parse(fileContents)
      return {name: basename(file).replace(/-_/g, ' '), testData}
    }),
  )

  test.each(testCases)('$name', async ({testData}) => {
    await withTmpDir(testRunPath, async (exportDir) => {
      const exportFilePath = joinPath(exportDir, 'out.tar.gz')
      for (const apiMock of testData.apiMocks) {
        for (const response of apiMock.responses) {
          await setupNock({url: apiMock.url, query: apiMock.query, response})
        }
      }

      const client = createClient({
        projectId: 'h5hc8cgs',
        dataset: 'production',
        useCdn: false,
        apiVersion: '1',
        token: 'REDACTED',
      })

      const options = {
        client,
        dataset: 'production',
        compress: true,
        assets: true,
        raw: false,
        onProgress: vi.fn(),
        outputPath: exportFilePath,
        retryDelayMs: 10,
      }

      if (testData.error) {
        await expect(exportDataset(options)).rejects.toThrow(testData.error)
      } else {
        await expect(exportDataset(options)).resolves.not.toThrow()
        await expectExportSuccess(exportDir, exportFilePath)
        expect(options.onProgress).toHaveBeenCalled()
      }

      expect(nock.isDone()).toBeTruthy()
    })
  })
})
