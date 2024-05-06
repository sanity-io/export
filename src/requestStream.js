const {getIt} = require('get-it')
const {keepAlive, promise} = require('get-it/middleware')
const debug = require('./debug')
const {extractFirstError} = require('./util/extractFirstError')
const {DOCUMENT_STREAM_MAX_RETRIES} = require('./constants')

const request = getIt([keepAlive(), promise({onlyBody: true})])
const socketsWithTimeout = new WeakSet()

const CONNECTION_TIMEOUT = 15 * 1000 // 15 seconds
const READ_TIMEOUT = 3 * 60 * 1000 // 3 minutes
const RETRY_DELAY_MS = 1500 // 1.5 seconds

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* eslint-disable no-await-in-loop, max-depth */
module.exports = async (options) => {
  const maxRetries =
    typeof options.maxRetries === 'number' ? options.maxRetries : DOCUMENT_STREAM_MAX_RETRIES

  let error
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await request({
        ...options,
        stream: true,
        maxRedirects: 0,
        timeout: {connect: CONNECTION_TIMEOUT, socket: READ_TIMEOUT},
      })

      if (
        response.connection &&
        typeof response.connection.setTimeout === 'function' &&
        !socketsWithTimeout.has(response.connection)
      ) {
        socketsWithTimeout.add(response.connection)
        response.connection.setTimeout(READ_TIMEOUT, () => {
          response.destroy(
            new Error(`Export: Read timeout: No data received on socket for ${READ_TIMEOUT} ms`),
          )
        })
      }

      return response
    } catch (err) {
      error = extractFirstError(err)

      if (err.response && err.response.statusCode && err.response.statusCode < 500) {
        break
      }

      debug('Error, retrying after %d ms: %s', RETRY_DELAY_MS, error.message)
      await delay(RETRY_DELAY_MS)
    }
  }

  error.message = `Export: Failed to fetch ${options.url}: ${error.message}`
  throw error
}
