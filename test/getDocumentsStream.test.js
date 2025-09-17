import {beforeEach, describe, expect, test, vi} from 'vitest'

// Mock needs to be hoisted - define mock factory without top-level variables
vi.mock('../src/requestStream.js', () => ({
  requestStream: vi.fn(),
}))

import {getDocumentsStream} from '../src/getDocumentsStream.js'
import {getUserAgent} from '../src/getUserAgent.js'
import {requestStream} from '../src/requestStream.js'

const getMockClient = () => ({
  getUrl: (path) => `https://projectid.api.sanity.io/v2021-06-07${path}`,
  config: () => ({token: 'skMockToken', projectId: 'projectid'}),
})

describe('getDocumentsStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestStream.mockResolvedValue({})
  })

  describe('URL construction', () => {
    test('constructs URL with no query parameters for dataset export', () => {
      const options = {
        dataset: 'production',
        client: getMockClient(),
        maxRetries: 2,
        readTimeout: 30000,
      }

      getDocumentsStream(options)

      expect(requestStream).toHaveBeenCalledWith({
        url: 'https://projectid.api.sanity.io/v2021-06-07/data/export/production',
        headers: {
          'User-Agent': getUserAgent(),
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

      getDocumentsStream(options)

      expect(requestStream).toHaveBeenCalledWith({
        url: 'https://projectid.api.sanity.io/v2021-06-07/data/export/production?types=article%2Cauthor',
        headers: {
          'User-Agent': getUserAgent(),
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

      getDocumentsStream(options)

      expect(requestStream).toHaveBeenCalledWith({
        url: 'https://projectid.api.sanity.io/v2021-06-07/media-libraries/media-lib-123/export?types=article%2Cauthor',
        headers: {
          'User-Agent': getUserAgent(),
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

      getDocumentsStream(options)

      expect(requestStream).toHaveBeenCalledWith({
        url: 'https://projectid.api.sanity.io/v2021-06-07/data/export/production?types=article%2Bspecial%2Cauthor%26category',
        headers: {
          'User-Agent': getUserAgent(),
          Authorization: 'Bearer skMockToken',
        },
        maxRetries: 2,
        readTimeout: 30000,
      })
    })
  })
})
