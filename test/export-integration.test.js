/*
This file contains integration tests for the exportDataset function and are based on fixtures
  in the fixtures directory. Each fixture contains a set of test cases that are run against the
  exportDataset function and a mocked backend API with disabled network requests.
*/

import {mkdtemp, readdir, readFile, stat} from 'node:fs/promises'
import path from 'node:path'

import {createClient} from '@sanity/client'
import nock from 'nock'
import {rimraf} from 'rimraf'
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'
import yaml from 'yaml'

import {exportDataset} from '../src/export.js'
import {ndjsonToArray, untarExportedFile} from './helpers/index.js'
import {newTestRunId, withTmpDir} from './helpers/suite.js'

const fixturesDirectory = path.join(import.meta.dirname, 'fixtures')

const expectExportSuccess = async (exportDir, exportFilePath) => {
  const stats = await stat(exportFilePath)
  expect(stats.size).toBeGreaterThan(0)

  const extractedDir = await untarExportedFile(exportDir, exportFilePath)

  const dataFile = await readFile(`${extractedDir}/data.ndjson`, 'utf8')
  expect(ndjsonToArray(dataFile)).toMatchSnapshot()

  const assetsFile = await readFile(`${extractedDir}/assets.json`, 'utf8')
  expect(JSON.parse(assetsFile)).toMatchSnapshot()
}

const setupNock = async ({url, query, response}) => {
  let u = new URL(url)
  const mockedApi = nock(u.origin).get(u.pathname ? u.pathname : '/')
  mockedApi.query(query ? query : {})

  let body
  if (response.bodyFromFile === true) {
    body = await readFile(path.join(fixturesDirectory, response.bodyFromFile))
  } else {
    body = response.body
  }
  mockedApi.reply(response.code ? response.code : 200, body)
}

describe('export integration tests', async () => {
  let testRunPath
  beforeAll(async () => {
    testRunPath = await mkdtemp(path.join(import.meta.dirname, `testrun_${newTestRunId()}`))
  })

  afterAll(async () => {
    nock.cleanAll()
    if (process.env.DO_NOT_DELETE !== 'true') {
      await rimraf(testRunPath)
    }
  })

  const prettyTestName = (filename) => {
    return path.parse(filename).name.replace(/-_/g, ' ')
  }

  const testFiles = (await readdir(fixturesDirectory)).filter((file) => file.endsWith('.yaml'))
  for (const file of testFiles) {
    const fullPath = path.join(fixturesDirectory, file)
    const fileContents = await readFile(fullPath, 'utf8')
    const testData = yaml.parse(fileContents)

    // eslint-disable-next-line no-loop-func
    test(prettyTestName(file), async () => {
      // eslint-disable-next-line max-nested-callbacks
      await withTmpDir(testRunPath, async (exportDir) => {
        const exportFilePath = path.join(exportDir, 'out.tar.gz')
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

        const opts = {
          client,
          dataset: 'production',
          compress: true,
          assets: true,
          raw: false,
          onProgress: vi.fn(),
          outputPath: exportFilePath,
        }

        if (testData.error) {
          await expect(exportDataset({...opts, ...testData.opts})).rejects.toThrow(testData.error)
        } else {
          await expect(exportDataset({...opts, ...testData.opts})).resolves.not.toThrow()
          await expectExportSuccess(exportDir, exportFilePath)
          expect(opts.onProgress).toHaveBeenCalled()
        }

        expect(nock.isDone()).toBeTruthy()
      })
    })
  }
})
