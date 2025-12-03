import {getIt} from 'get-it'
import {keepAlive, promise} from 'get-it/middleware'

import {delay} from './util/delay'
import {tryThrowFriendlyError} from './util/friendlyError.js'
import {DEFAULT_RETRY_DELAY, DOCUMENT_STREAM_MAX_RETRIES, REQUEST_READ_TIMEOUT} from './constants.js'
import {debug} from './debug.js'
import {extractFirstError} from './util/extractFirstError.js'

const request = getIt([keepAlive(), promise({onlyBody: true})])

const CONNECTION_TIMEOUT = 15 * 1000 // 15 seconds

/* eslint-disable no-await-in-loop, max-depth */
export async function requestStream(options) {
  const maxRetries =
    typeof options.maxRetries === 'number' ? options.maxRetries : DOCUMENT_STREAM_MAX_RETRIES

  const readTimeout =
    typeof options.readTimeout === 'number' ? options.readTimeout : REQUEST_READ_TIMEOUT

  const retryDelayMs =
    typeof options.retryDelayMs === 'number' ? options.retryDelayMs : DEFAULT_RETRY_DELAY

  let error
  for (let i = 0; i < maxRetries || (maxRetries === 0 && i === 0); i++) {
    try {
      return await request({
        ...options,
        stream: true,
        maxRedirects: 0,
        timeout: {connect: CONNECTION_TIMEOUT, socket: readTimeout},
      })
    } catch (err) {
      error = extractFirstError(err) || err

      if (err.response && err.response.statusCode && err.response.statusCode < 500) {
        break
      }

      if (i + 1 >= maxRetries && maxRetries !== 0) {
        debug('Error, retrying after %d ms: %s', retryDelayMs, error.message)
        await delay(retryDelayMs)
      }
    }
  }

  await tryThrowFriendlyError(error)

  error.message = `Export: Failed to fetch ${options.url}: ${error.message}`
  throw error
}
