const {describe, expect, test, beforeEach} = require('@jest/globals')

const getMockClient = () => ({
  getUrl: (path) => `https://projectid.api.sanity.io/v2021-06-07${path}`,
  config: () => ({token: 'skMockToken', projectId: 'projectid'}),
})

// Mock the requestStream module
const mockRequestStream = jest.fn()
jest.mock('../src/requestStream', () => mockRequestStream)

const getDocumentsStreamTest = require('../src/getDocumentsStream')
const pkg = require('../package.json')

describe('getDocumentsStream', () => {
  beforeEach(() => {
    mockRequestStream.mockClear()
    mockRequestStream.mockResolvedValue({})
  })

  describe('URL construction', () => {
    test('constructs URL with no query parameters for dataset export', () => {
      const options = {
        dataset: 'production',
        client: getMockClient(),
        maxRetries: 2,
        readTimeout: 30000,
      }

      getDocumentsStreamTest(options)

      expect(mockRequestStream).toHaveBeenCalledWith({
        url: 'https://projectid.api.sanity.io/v2021-06-07/data/export/production',
        headers: {
          'User-Agent': `${pkg.name}@${pkg.version}`,
          Authorization: 'Bearer skMockToken',
        },
        maxRetries: 2,
        readTimeout: 30000,
      })
    })

    test('constructs URL with types parameter for dataset export', () => {
      const options = {
        dataset: 'production',
        client: getMockClient(),
        types: ['article', 'author'],
        maxRetries: 2,
        readTimeout: 30000,
      }

      getDocumentsStreamTest(options)

      expect(mockRequestStream).toHaveBeenCalledWith({
        url: 'https://projectid.api.sanity.io/v2021-06-07/data/export/production?types=article%2Cauthor',
        headers: {
          'User-Agent': `${pkg.name}@${pkg.version}`,
          Authorization: 'Bearer skMockToken',
        },
        maxRetries: 2,
        readTimeout: 30000,
      })
    })

    test('constructs URL for media library export with types parameter', () => {
      const options = {
        mediaLibraryId: 'media-lib-123',
        client: getMockClient(),
        types: ['article', 'author'],
        maxRetries: 2,
        readTimeout: 30000,
      }

      getDocumentsStreamTest(options)

      expect(mockRequestStream).toHaveBeenCalledWith({
        url: 'https://projectid.api.sanity.io/v2021-06-07/media-libraries/media-lib-123/export?types=article%2Cauthor',
        headers: {
          'User-Agent': `${pkg.name}@${pkg.version}`,
          Authorization: 'Bearer skMockToken',
        },
        maxRetries: 2,
        readTimeout: 30000,
      })
    })

    test('handles special characters in types parameter', () => {
      const options = {
        dataset: 'production',
        client: getMockClient(),
        types: ['article+special', 'author&category'],
        maxRetries: 2,
        readTimeout: 30000,
      }

      getDocumentsStreamTest(options)

      expect(mockRequestStream).toHaveBeenCalledWith({
        url: 'https://projectid.api.sanity.io/v2021-06-07/data/export/production?types=article%2Bspecial%2Cauthor%26category',
        headers: {
          'User-Agent': `${pkg.name}@${pkg.version}`,
          Authorization: 'Bearer skMockToken',
        },
        maxRetries: 2,
        readTimeout: 30000,
      })
    })
  })
})
