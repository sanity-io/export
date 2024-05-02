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
const {generateRandomImage} = require('./helpers/images')

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

const setupNock = ({baseUrl, route, query, responseCode, responseBody, generateResponseFile}) => {
  const mockedApi = nock(baseUrl).get(route ? route : '/')
  mockedApi.query(query ? query : {})
  mockedApi.reply(
    responseCode ? responseCode : 200,
    generateResponseFile === 'true' ? generateRandomImage() : responseBody,
  )
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
          setupNock(apiMock)
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
          compress: false,
          assets: true,
          raw: false,
          onProgress: jest.fn(),
          outputPath: exportFilePath,
        }

        if (testData.exportFails) {
          await expect(exportDataset({...opts, ...testData.opts})).rejects.toThrow()
        } else {
          await expect(exportDataset({...opts, ...testData.opts})).resolves.not.toThrow()
          await assertExportSuccess(
            exportDir,
            exportFilePath,
            JSON.parse(testData.documentsFile),
            JSON.parse(testData.assetsFile),
          )
          expect(opts.onProgress).toHaveBeenCalled()
        }

        expect(nock.isDone()).toBeTruthy()
      })
    })
  })
})
