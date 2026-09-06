/*
This file contains integration tests for the exportDataset function and are based on fixtures
  in the fixtures directory. Each fixture contains a set of test cases that are run against the
  exportDataset function and a mocked backend API with disabled network requests.
*/

import {mkdir, mkdtemp, readdir, readFile, rm, stat} from 'node:fs/promises'
import {basename, join as joinPath} from 'node:path'

import {createClient} from '@sanity/client'
import {createMockFetch, streamBody, type MockFetch, type MockResponseDef} from 'get-it/mock'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'

import {exportDataset} from '../src/export.js'
import {setFetchImplementation} from '../src/requestStream.js'
import {ndjsonToArray, untarExportedFile} from './helpers/index.js'
import {newTestRunId, withTmpDir} from './helpers/suite.js'

const fixturesDirectory = joinPath(import.meta.dirname, 'fixtures')

const expectExportSuccess = async (exportDir: string, exportFilePath: string): Promise<void> => {
  const stats = await stat(exportFilePath)
  expect(stats.size).toBeGreaterThan(0)

  const extractedDir = await untarExportedFile(exportDir, exportFilePath)

  const dataFile = await readFile(`${extractedDir}/data.ndjson`, 'utf8')
  expect(ndjsonToArray(dataFile)).toMatchSnapshot()

  const assetsFile = await readFile(`${extractedDir}/assets.json`, 'utf8')
  expect(JSON.parse(assetsFile)).toMatchSnapshot()
}

interface ApiMockResponse {
  code?: number
  body?: string
  bodyFromFile?: string
}

interface ApiMock {
  url: string
  query?: Record<string, string | number | boolean>
  responses: Array<ApiMockResponse>
}

interface TestData {
  apiMocks: Array<ApiMock>
  error?: string
}

/**
 * Assets are served as binary, so they have to go through a `streamBody()` script -
 * a plain `body` is only ever encoded as text.
 */
const getResponseBody = async (response: ApiMockResponse): Promise<MockResponseDef> => {
  if (response.bodyFromFile) {
    const file = await readFile(joinPath(fixturesDirectory, response.bodyFromFile))
    return {body: streamBody(new Uint8Array(file))}
  }

  return response.body === undefined ? {} : {body: response.body}
}

const registerApiMock = async (mock: MockFetch, apiMock: ApiMock): Promise<void> => {
  const url = new URL(apiMock.url)
  for (const [key, value] of Object.entries(apiMock.query ?? {})) {
    url.searchParams.set(key, String(value))
  }

  const handler = mock.on('GET', url.toString())
  for (const response of apiMock.responses) {
    handler.respond({status: response.code ?? 200, ...(await getResponseBody(response))})
  }
}

interface TestCase {
  name: string
  testData: TestData
}

describe('export integration tests', async () => {
  let testRunPath: string
  let mock: MockFetch

  beforeAll(async () => {
    await mkdir(joinPath(import.meta.dirname, 'testruns'), {recursive: true})
    testRunPath = await mkdtemp(
      joinPath(import.meta.dirname, 'testruns', `testrun_${newTestRunId()}`),
    )
  })

  afterAll(async () => {
    if (process.env.DO_NOT_DELETE !== 'true') {
      await rm(testRunPath, {recursive: true, force: true})
    }
  })

  beforeEach(() => {
    // Any request that isn't explicitly mocked below rejects, so no test can reach the network
    mock = createMockFetch()
    setFetchImplementation(mock.fetch)
  })

  afterEach(() => {
    setFetchImplementation(undefined)
  })

  const testFiles = (await readdir(fixturesDirectory)).filter((file) => file.endsWith('.json'))
  const testCases: TestCase[] = await Promise.all(
    testFiles.map(async (file) => {
      const fullPath = joinPath(fixturesDirectory, file)
      const fileContents = await readFile(fullPath, 'utf8')
      const testData = JSON.parse(fileContents) as TestData
      return {name: basename(file).replace(/-_/g, ' '), testData}
    }),
  )

  test.each(testCases)('$name', async ({testData}: TestCase) => {
    await withTmpDir(testRunPath, async (exportDir: string) => {
      const exportFilePath = joinPath(exportDir, 'out.tar.gz')
      for (const apiMock of testData.apiMocks) {
        await registerApiMock(mock, apiMock)
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

      mock.assertAllConsumed()
    })
  })
})
