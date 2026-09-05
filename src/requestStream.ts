import {Readable} from 'node:stream'

import {createRequester, type FetchFunction, type StreamResponse} from 'get-it'

import {delay} from './util/delay.js'
import {extractFirstError} from './util/extractFirstError.js'
import {tryThrowFriendlyError} from './util/friendlyError.js'
import {
  DEFAULT_RETRY_DELAY,
  DOCUMENT_STREAM_MAX_RETRIES,
  REQUEST_READ_TIMEOUT,
} from './constants.js'
import {debug} from './debug.js'
import type {RequestStreamOptions, ResponseStream} from './types.js'

interface ErrorWithResponse extends Error {
  response?: {
    statusCode?: number
  }
}

const CONNECTION_TIMEOUT = 15 * 1000 // 15 seconds

// Note the lack of a `retry()` middleware: retrying is the caller's business here, since
// how many attempts to make (and how long to wait between them) differs between the
// document stream and the asset downloads. See `maxRetries` / `retryDelayMs` below.
const request = createRequester({
  as: 'stream',
  // Non-2xx responses are handed back to the caller instead of throwing, so that the
  // status code and the response body can be inspected (and retried) by the caller.
  httpErrors: false,
  // A total deadline would abort long-running exports part-way through the download,
  // so only the time to receive the response headers is bounded here. Inactivity while
  // the body is streaming is enforced by `readTimeout`, see `toResponseStream()`.
  timeout: {headers: CONNECTION_TIMEOUT, total: false},
})

let fetchOverride: FetchFunction | undefined

/**
 * Overrides the `fetch` implementation used for every request made by the exporter.
 * Pass `undefined` to restore the default. Intended for testing.
 *
 * @internal
 */
export function setFetchImplementation(fetch: FetchFunction | undefined): void {
  fetchOverride = fetch
}

export async function requestStream(options: RequestStreamOptions): Promise<ResponseStream> {
  const maxRetries =
    options.maxRetries !== undefined ? options.maxRetries : DOCUMENT_STREAM_MAX_RETRIES

  const readTimeout = options.readTimeout !== undefined ? options.readTimeout : REQUEST_READ_TIMEOUT

  const retryDelayMs =
    options.retryDelayMs !== undefined ? options.retryDelayMs : DEFAULT_RETRY_DELAY

  let error: ErrorWithResponse | undefined

  let i = 0
  do {
    i++

    try {
      const response = await request({
        url: options.url,
        ...(options.headers ? {headers: options.headers} : {}),
        ...(fetchOverride ? {fetch: fetchOverride} : {}),
        // `fetch()` cannot cap the number of redirects it follows, so - as with the
        // `maxRedirects: 0` this used to pass - any redirect is treated as an error.
        redirect: 'error',
      })

      return toResponseStream(response, readTimeout)
    } catch (err) {
      const firstError = extractFirstError(err)
      error = firstError instanceof Error ? firstError : toError(err)

      if (maxRetries === 0) {
        throw error
      }

      if (error.response?.statusCode && error.response.statusCode < 500) {
        break
      }

      if (i < maxRetries) {
        debug('Error, retrying after %d ms: %s', retryDelayMs, error.message)
        await delay(retryDelayMs)
      }
    }
  } while (i < maxRetries)

  await tryThrowFriendlyError(error)

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!error) {
    throw new Error(`Export: Failed to fetch ${options.url}: Unknown error`)
  }

  throw new Error(`Export: Failed to fetch ${options.url}: ${error.message}`)
}

/**
 * Adapts a `fetch()` response with a web `ReadableStream` body to the node stream the
 * rest of the exporter consumes, carrying the status code and headers along with it.
 *
 * Reading is bounded by `readTimeout`: because the timer is armed while we are waiting
 * for a chunk the consumer has asked for, a stalled connection fails instead of hanging
 * forever, while a slow-but-progressing download is left alone. A backpressured consumer
 * does not trip it either, since node only asks for more data once it is ready for it.
 */
function toResponseStream(response: StreamResponse, readTimeout: number): ResponseStream {
  const reader = response.body.getReader()
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const stream = new Readable({
    read() {
      if (readTimeout > 0) {
        idleTimer = setTimeout(() => {
          this.destroy(
            new Error(`Timed out after ${readTimeout}ms of inactivity while reading response`),
          )
        }, readTimeout)
      }

      void reader.read().then(
        ({done, value}) => {
          clearTimeout(idleTimer)
          if (this.destroyed) {
            return
          }

          this.push(done ? null : value)
        },
        (err: unknown) => {
          clearTimeout(idleTimer)
          if (this.destroyed) {
            return
          }

          this.destroy(toError(err))
        },
      )
    },

    destroy(err, callback) {
      clearTimeout(idleTimer)

      // Release the underlying connection rather than leaving it hanging around
      reader.cancel(err ?? undefined).then(
        () => callback(err),
        () => callback(err),
      )
    },
  })

  return Object.assign(stream, {statusCode: response.status, headers: response.headers})
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(`${err}`)
}
