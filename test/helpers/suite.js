const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const rimraf = require('../../src/util/rimraf')

// Generate unique test run ID, to be used in naming temporary directories for whole suite.
// Allows multiple test suites to run in parallel without interfering with each other.
const newTestRunId = () => {
  return (Math.random() + 1).toString(36).substring(4)
}

// Generate a hash ID for a test name, to be used in naming temporary directories for individual tests.
const generateTestHashId = (testName) => {
  return crypto.createHash('sha1').update(testName).digest('hex').substring(0, 6)
}

// Run a callback after creating a directory and clean it up after.
const withTmpDir = async (outputDirPath, fn) => {
  const testHashId = generateTestHashId(expect.getState().currentTestName)
  const tmpDir = fs.mkdirSync(path.join(outputDirPath, `test-${testHashId}`), {recursive: true})
  try {
    await fn(tmpDir)
  } finally {
    if (process.env.DO_NOT_DELETE !== 'true') {
      await rimraf(tmpDir)
    }
  }
}

module.exports = {
  newTestRunId,
  generateTestHashId,
  withTmpDir,
}
