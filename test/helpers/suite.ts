import {createHash} from 'node:crypto'
import {mkdir, rm} from 'node:fs/promises'
import {join as joinPath} from 'node:path'

import {expect} from 'vitest'

// Generate unique test run ID, to be used in naming temporary directories for whole suite.
// Allows multiple test suites to run in parallel without interfering with each other.
export const newTestRunId = (): string => {
  return (Math.random() + 1).toString(36).substring(4)
}

// Generate a hash ID for a test name, to be used in naming temporary directories for individual tests.
const generateTestHashId = (testName: string): string => {
  return createHash('sha1').update(testName).digest('hex').substring(0, 6)
}

// Run a callback after creating a directory and clean it up after.
export const withTmpDir = async (
  outputDirPath: string,
  fn: (tmpDir: string) => Promise<void>,
): Promise<void> => {
  const currentTestName = expect.getState().currentTestName
  const testHashId = generateTestHashId(currentTestName ?? 'unknown')
  const tmpDir = joinPath(outputDirPath, `test-${testHashId}`)
  await mkdir(tmpDir, {recursive: true})
  try {
    await fn(tmpDir)
  } finally {
    if (process.env.DO_NOT_DELETE !== 'true') {
      await rm(tmpDir, {recursive: true, force: true})
    }
  }
}
