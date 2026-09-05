import {createMockFetch, streamBody, streamDelay, streamStall, type MockFetch} from 'get-it/mock'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {requestStream, setFetchImplementation} from '../src/requestStream.js'
import type {ResponseStream} from '../src/types.js'

const readAll = async (stream: ResponseStream): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

describe('requestStream', () => {
  let mock: MockFetch

  beforeEach(() => {
    mock = createMockFetch()
    setFetchImplementation(mock.fetch)
  })

  afterEach(() => {
    setFetchImplementation(undefined)
  })

  test('exposes the status code and response headers alongside the body', async () => {
    mock.on('GET', 'https://example.test/doc').respond({
      status: 200,
      body: 'hello',
      headers: {'x-sanity-sha1': 'abc123'},
    })

    const stream = await requestStream({url: 'https://example.test/doc'})

    expect(stream.statusCode).toBe(200)
    expect(stream.headers?.get('x-sanity-sha1')).toBe('abc123')
    await expect(readAll(stream)).resolves.toBe('hello')
  })

  test('hands back non-2xx responses instead of throwing', async () => {
    mock.on('GET', 'https://example.test/missing').respond({status: 404, body: 'nope'})

    const stream = await requestStream({url: 'https://example.test/missing', maxRetries: 0})

    expect(stream.statusCode).toBe(404)
    await expect(readAll(stream)).resolves.toBe('nope')
  })

  test('fails a response that stalls part-way through the body', async () => {
    mock.on('GET', 'https://example.test/stalls').respond({
      status: 200,
      body: streamBody('partial', streamStall()),
    })

    const stream = await requestStream({
      url: 'https://example.test/stalls',
      maxRetries: 0,
      readTimeout: 50,
    })

    // The response itself arrives fine - it is reading the body that times out
    expect(stream.statusCode).toBe(200)
    await expect(readAll(stream)).rejects.toThrow('Timed out after 50ms of inactivity')
  })

  test('does not time out a slow response that keeps making progress', async () => {
    // Four gaps of 40ms each: comfortably under the 120ms of inactivity allowed
    // between chunks, but well over it in total.
    mock.on('GET', 'https://example.test/slow').respond({
      status: 200,
      body: streamBody(
        'a',
        streamDelay(40),
        'b',
        streamDelay(40),
        'c',
        streamDelay(40),
        'd',
        streamDelay(40),
        'e',
      ),
    })

    const stream = await requestStream({
      url: 'https://example.test/slow',
      maxRetries: 0,
      readTimeout: 120,
    })

    await expect(readAll(stream)).resolves.toBe('abcde')
  })

  test('retries transport-level failures and reports the underlying cause', async () => {
    mock
      .on('GET', 'https://example.test/flaky')
      .respondWithError(
        () =>
          new TypeError('fetch failed', {
            cause: Object.assign(new Error('read ECONNRESET'), {code: 'ECONNRESET'}),
          }),
      )
      .respond({status: 200, body: 'recovered'})

    const stream = await requestStream({
      url: 'https://example.test/flaky',
      maxRetries: 2,
      retryDelayMs: 0,
    })
    await expect(readAll(stream)).resolves.toBe('recovered')
  })

  test('reports the underlying cause when a request fails for good', async () => {
    mock.on('GET', 'https://example.test/down').respondWithErrorPersist(
      () =>
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
            code: 'ECONNREFUSED',
          }),
        }),
    )

    // `fetch()` reports every transport failure as an opaque "fetch failed", so the
    // actual reason has to be dug out of `cause` for the message to be of any use.
    await expect(
      requestStream({url: 'https://example.test/down', maxRetries: 1, retryDelayMs: 0}),
    ).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:443')
  })
})
