import {describe, expect, test} from 'vitest'

import {validateOptions} from '../src/options.js'
import type {SanityClientLike, SanityDocument} from '../src/types.js'

const getMockClient = (): SanityClientLike => ({
  getUrl: (path: string) => `http://localhost:3000${path}`,
  config: () => ({token: 'skSomeToken'}),
})

const validOptions = () => ({
  dataset: 'production',
  client: getMockClient(),
  outputPath: '/tmp/out.tar.gz',
})

describe('validateOptions', () => {
  test('accepts valid options', () => {
    const result = validateOptions(validOptions())
    expect(result).toMatchObject({
      dataset: 'production',
      outputPath: '/tmp/out.tar.gz',
    })
  })

  test('throws if client is missing', () => {
    expect(() =>
      validateOptions({
        dataset: 'production',
        // @ts-expect-error Testing missing client
        client: undefined,
        outputPath: '/tmp/out.tar.gz',
      }),
    ).toThrow('`options.client` must be set to an instance of @sanity/client')
  })

  test('throws if client is not a valid sanity client', () => {
    expect(() =>
      validateOptions({
        dataset: 'production',
        // @ts-expect-error Testing invalid client
        client: {notAClient: true},
        outputPath: '/tmp/out.tar.gz',
      }),
    ).toThrow('`options.client` must be set to an instance of @sanity/client')
  })

  test('throws if client has no token', () => {
    expect(() =>
      validateOptions({
        dataset: 'production',
        client: {
          getUrl: (path: string) => `http://localhost${path}`,
          config: () => ({token: undefined}),
        },
        outputPath: '/tmp/out.tar.gz',
      }),
    ).toThrow('Client is not instantiated with a `token`')
  })

  test('throws if both dataset and mediaLibraryId are specified', () => {
    expect(() =>
      validateOptions({
        // @ts-expect-error Testing both specified
        dataset: 'production',
        mediaLibraryId: 'lib-123',
        client: getMockClient(),
        outputPath: '/tmp/out.tar.gz',
      }),
    ).toThrow('either `options.dataset` or `options.mediaLibraryId` must be specified, got both')
  })

  test('throws if neither dataset nor mediaLibraryId is specified', () => {
    expect(() =>
      validateOptions({
        // @ts-expect-error Testing neither specified
        client: getMockClient(),
        outputPath: '/tmp/out.tar.gz',
      }),
    ).toThrow('either `options.dataset` or `options.mediaLibraryId` must be specified, got neither')
  })

  test('throws if dataset is empty string', () => {
    expect(() =>
      validateOptions({
        dataset: '  ',
        client: getMockClient(),
        outputPath: '/tmp/out.tar.gz',
      }),
    ).toThrow('Source (dataset) specified but was empty')
  })

  test('throws if mediaLibraryId is empty string', () => {
    expect(() =>
      validateOptions({
        mediaLibraryId: '  ',
        client: getMockClient(),
        outputPath: '/tmp/out.tar.gz',
      }),
    ).toThrow('Source (media-library) specified but was empty')
  })

  test('throws if mode is invalid', () => {
    expect(() =>
      // @ts-expect-error Testing invalid mode
      validateOptions({...validOptions(), mode: 'invalid'}),
    ).toThrow('options.mode must be either "stream" or "cursor", got "invalid"')
  })

  test('throws if onProgress is not a function', () => {
    expect(() =>
      // @ts-expect-error Testing invalid onProgress
      validateOptions({...validOptions(), onProgress: 'not-a-function'}),
    ).toThrow('options.onProgress must be a function')
  })

  test('throws if boolean flags are not boolean', () => {
    for (const flag of ['assets', 'raw', 'compress', 'drafts'] as const) {
      expect(() =>
        // @ts-expect-error Testing invalid boolean
        validateOptions({...validOptions(), [flag]: 'yes'}),
      ).toThrow(`Flag ${flag} must be a boolean (true/false)`)
    }
  })

  test('throws if number flags are not numbers', () => {
    for (const flag of [
      'maxAssetRetries',
      'maxRetries',
      'assetConcurrency',
      'readTimeout',
    ] as const) {
      expect(() =>
        // @ts-expect-error Testing invalid number
        validateOptions({...validOptions(), [flag]: 'fast'}),
      ).toThrow(`Flag ${flag} must be a number if specified`)
    }
  })

  test('throws if outputPath is missing', () => {
    expect(() =>
      validateOptions({
        dataset: 'production',
        client: getMockClient(),
        // @ts-expect-error Testing missing outputPath
        outputPath: undefined,
      }),
    ).toThrow('outputPath must be specified (- for stdout)')
  })

  test('throws if assetConcurrency is below 1', () => {
    expect(() => validateOptions({...validOptions(), assetConcurrency: -1})).toThrow(
      '`assetConcurrency` must be between 1 and 24',
    )
  })

  test('throws if assetConcurrency is above 24', () => {
    expect(() => validateOptions({...validOptions(), assetConcurrency: 25})).toThrow(
      '`assetConcurrency` must be between 1 and 24',
    )
  })

  test('accepts valid assetConcurrency', () => {
    const result = validateOptions({...validOptions(), assetConcurrency: 12})
    expect(result.assetConcurrency).toBe(12)
  })

  test('throws if filterDocument is not a function', () => {
    expect(() =>
      // @ts-expect-error Testing invalid filterDocument
      validateOptions({...validOptions(), filterDocument: 'not-a-function'}),
    ).toThrow('`filterDocument` must be a function')
  })

  test('throws if transformDocument is not a function', () => {
    expect(() =>
      // @ts-expect-error Testing invalid transformDocument
      validateOptions({...validOptions(), transformDocument: 42}),
    ).toThrow('`transformDocument` must be a function')
  })

  test('throws if assetsMap is not a boolean', () => {
    expect(() =>
      // @ts-expect-error Testing invalid assetsMap
      validateOptions({...validOptions(), assetsMap: 'yes'}),
    ).toThrow('`assetsMap` must be a boolean')
  })

  test('applies default values', () => {
    const result = validateOptions(validOptions())
    expect(result.compress).toBe(true)
    expect(result.drafts).toBe(true)
    expect(result.assets).toBe(true)
    expect(result.raw).toBe(false)
    expect(result.mode).toBe('stream')
    expect(result.assetsMap).toBe(true)
    expect(typeof result.filterDocument).toBe('function')
    expect(typeof result.transformDocument).toBe('function')
  })

  test('default filterDocument passes all documents', () => {
    const result = validateOptions(validOptions())
    expect(result.filterDocument({_id: 'test', _type: 'doc'} as SanityDocument)).toBe(true)
  })

  test('default transformDocument returns document unchanged', () => {
    const result = validateOptions(validOptions())
    const doc = {_id: 'test', _type: 'doc'} as SanityDocument
    expect(result.transformDocument(doc)).toBe(doc)
  })

  test('accepts mediaLibraryId as source', () => {
    const result = validateOptions({
      mediaLibraryId: 'my-lib',
      client: getMockClient(),
      outputPath: '/tmp/out.tar.gz',
    })
    expect(result).toMatchObject({mediaLibraryId: 'my-lib'})
  })
})
