/*
This file contains integration tests for the exportDataset function and are based on fixtures
  in the fixtures directory. Each fixture contains a set of test cases that are run against the
  exportDataset function and a mocked backend API with disabled network requests.
*/

const fs = require('fs')
const yaml = require('yaml')
const nock = require('nock')
const path = require('path')
const {afterAll, describe, expect, test} = require('@jest/globals')
const exportDataset = require('../src/export')
const rimraf = require('../src/util/rimraf')
const sanity = require('@sanity/client')
const {untarExportedFile, ndjsonToArray} = require('./helpers')
const {newTestRunId, withTmpDir} = require('./helpers/suite')

const fixturesDirectory = path.join(__dirname, 'fixtures')
const testif = (condition) => (condition ? test : test.skip)

const assertExportSuccess = async (exportDir, exportFilePath, dataContent, assetsContent) => {
  expect(fs.existsSync(exportFilePath)).toBeTruthy()
  const stats = fs.statSync(exportFilePath)
  expect(stats.size).toBeGreaterThan(0)

  const extractedDir = await untarExportedFile(exportDir, exportFilePath)
  expect(fs.existsSync(extractedDir)).toBeTruthy()
  expect(ndjsonToArray(fs.readFileSync(`${extractedDir}/data.ndjson`, 'utf8'))).toEqual(dataContent)
  expect(JSON.parse(fs.readFileSync(`${extractedDir}/assets.json`, 'utf8'))).toEqual(assetsContent)
}

const setupNock = ({url, query, response}) => {
  let u = new URL(url)
  const mockedApi = nock(u.origin).get(u.pathname ? u.pathname : '/')
  mockedApi.query(query ? query : {})
  let body =
    response.bodyFromFile === true
      ? fs.readFileSync(path.join(fixturesDirectory, response.bodyFromFile))
      : response.body

  mockedApi.reply(response.code ? response.code : 200, body)
}

describe('exportDataset function', () => {
  let testRunPath
  beforeAll(() => {
    testRunPath = fs.mkdtempSync(path.join(__dirname, `testrun_${newTestRunId()}`))
  })

  afterAll(async () => {
    nock.cleanAll()
    if (process.env.DO_NOT_DELETE !== 'true') {
      await rimraf(testRunPath)
    }
  })

  const testFiles = fs.readdirSync(fixturesDirectory).filter((file) => file.endsWith('.yaml'))
  testFiles.forEach((file) => {
    const fullPath = path.join(fixturesDirectory, file)
    const fileContents = fs.readFileSync(fullPath, 'utf8')
    const testData = yaml.parse(fileContents)

    testif(testData.skip !== true)(path.parse(file).name, async () => {
      // eslint-disable-next-line max-nested-callbacks
      await withTmpDir(testRunPath, async (exportDir) => {
        const exportFilePath = path.join(exportDir, 'out.tar.gz')
        for (const apiMock of testData.apiMocks) {
          for (const response of apiMock.responses) {
            setupNock({url: apiMock.url, query: apiMock.query, response})
          }
        }

        const client = sanity.createClient({
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
          onProgress: jest.fn(),
          outputPath: exportFilePath,
        }

        if (testData.error) {
          await expect(exportDataset({...opts, ...testData.opts})).rejects.toThrow(testData.error)
        } else {
          await expect(exportDataset({...opts, ...testData.opts})).resolves.not.toThrow()
          await assertExportSuccess(
            exportDir,
            exportFilePath,
            JSON.parse(testData.out.documents),
            JSON.parse(testData.out.assets),
          )
          expect(opts.onProgress).toHaveBeenCalled()
        }

        expect(nock.isDone()).toBeTruthy()
      })
    })
  })
})
