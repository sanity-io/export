/*
This file contains integration tests for the exportDataset function and are based on fixtures
  in the fixtures directory. Each fixture contains a set of test cases that are run against the
  exportDataset function and a mocked backend API with disabled network requests.
*/

const exportDataset = require('../src/export')
const fs = require('fs/promises')
const {readdirSync, readFileSync} = require('fs') // TODO: switch to fs/promises
const nock = require('nock')
const path = require('path')
const rimraf = require('../src/util/rimraf')
const sanity = require('@sanity/client')
const yaml = require('yaml')
const {afterAll, describe, expect, test} = require('@jest/globals')
const {newTestRunId, withTmpDir} = require('./helpers/suite')
const {untarExportedFile, ndjsonToArray} = require('./helpers')

const fixturesDirectory = path.join(__dirname, 'fixtures')

const expectExportSuccess = async (exportDir, exportFilePath) => {
  const stats = await fs.stat(exportFilePath)
  expect(stats.size).toBeGreaterThan(0)

  const extractedDir = await untarExportedFile(exportDir, exportFilePath)

  const dataFile = await fs.readFile(`${extractedDir}/data.ndjson`, 'utf8')
  expect(ndjsonToArray(dataFile)).toMatchSnapshot()

  const assetsFile = await fs.readFile(`${extractedDir}/assets.json`, 'utf8')
  expect(JSON.parse(assetsFile)).toMatchSnapshot()
}

const setupNock = async ({url, query, response}) => {
  let u = new URL(url)
  const mockedApi = nock(u.origin).get(u.pathname ? u.pathname : '/')
  mockedApi.query(query ? query : {})

  let body
  if (response.bodyFromFile === true) {
    body = await fs.readFile(path.join(fixturesDirectory, response.bodyFromFile))
  } else {
    body = response.body
  }
  mockedApi.reply(response.code ? response.code : 200, body)
}

describe('export integration tests', () => {
  let testRunPath
  beforeAll(async () => {
    testRunPath = await fs.mkdtemp(path.join(__dirname, `testrun_${newTestRunId()}`))
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

  const testFiles = readdirSync(fixturesDirectory).filter((file) => file.endsWith('.yaml'))
  testFiles.forEach((file) => {
    const fullPath = path.join(fixturesDirectory, file)
    const fileContents = readFileSync(fullPath, 'utf8')
    const testData = yaml.parse(fileContents)

    test(prettyTestName(file), async () => {
      // eslint-disable-next-line max-nested-callbacks
      await withTmpDir(testRunPath, async (exportDir) => {
        const exportFilePath = path.join(exportDir, 'out.tar.gz')
        for (const apiMock of testData.apiMocks) {
          for (const response of apiMock.responses) {
            await setupNock({url: apiMock.url, query: apiMock.query, response})
          }
        }

        const client = sanity.createClient({
          projectId: 'h5hc8cgs',
          dataset: 'production',
          useCdn: false,
          apiVersion: '2025-02-19',
          token: 'REDACTED',
        })

        const opts = {
          client,
          dataset: 'production',
          compress: true,
          assets: true,
          raw: false,
          onProgress: jest.fn(),
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
  })
})
