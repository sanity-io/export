import {createHash} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {join as joinPath} from 'node:path'

import {rimraf} from 'rimraf'
import {expect} from 'vitest'

// Generate unique test run ID, to be used in naming temporary directories for whole suite.
// Allows multiple test suites to run in parallel without interfering with each other.
export const newTestRunId = () => {
  return (Math.random() + 1).toString(36).substring(4)
}

// Generate a hash ID for a test name, to be used in naming temporary directories for individual tests.
export const generateTestHashId = (testName) => {
  return createHash('sha1').update(testName).digest('hex').substring(0, 6)
}

// Run a callback after creating a directory and clean it up after.
export const withTmpDir = async (outputDirPath, fn) => {
  const testHashId = generateTestHashId(expect.getState().currentTestName)
  const tmpDir = await mkdir(joinPath(outputDirPath, `test-${testHashId}`), {recursive: true})
  try {
    await fn(tmpDir)
  } finally {
    if (process.env.DO_NOT_DELETE !== 'true') {
      await rimraf(tmpDir)
    }
  }
}
