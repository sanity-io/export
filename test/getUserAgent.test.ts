import {readFileSync} from 'node:fs'
import {dirname, join as joinPath} from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, expect, test} from 'vitest'

import {getUserAgent} from '../src/getUserAgent.js'

describe('getUserAgent', () => {
  test('returns package name and version', () => {
    const ua = getUserAgent()
    expect(ua).toMatch(/^@sanity\/export@\d+\.\d+\.\d+$/)
  })

  test('returns same value on repeated calls', () => {
    const first = getUserAgent()
    const second = getUserAgent()
    expect(first).toBe(second)
  })

  test('matches the actual package.json values', () => {
    const pkgPath = joinPath(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {name: string; version: string}
    expect(getUserAgent()).toBe(`${pkg.name}@${pkg.version}`)
  })
})
