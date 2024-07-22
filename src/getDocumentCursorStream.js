const {Transform} = require('node:stream')

const pkg = require('../package.json')
const debug = require('./debug')
const requestStream = require('./requestStream')

module.exports = async (options) => {
  let streamsInflight = 0
  const stream = new Transform({
    async transform(chunk, encoding, callback) {
      if (encoding !== 'buffer' && encoding !== 'string') {
        callback(null, chunk)
        return
      }

      let parsedChunk = null
      try {
        const chunkStr = chunk.toString()
        if (chunkStr.trim() !== '') {
          parsedChunk = JSON.parse(chunkStr)
        }
      } catch (err) {
        // Ignore JSON parse errors
        // this can happen if the chunk is not a JSON object. We just pass it through and let the caller handle it.
        debug('Failed to parse JSON chunk', err)
      }

      if (
        parsedChunk !== null &&
        typeof parsedChunk === 'object' &&
        'nextCursor' in parsedChunk &&
        typeof parsedChunk.nextCursor === 'string' &&
        !('_id' in parsedChunk)
      ) {
        debug('Got next cursor, fetching next stream', parsedChunk.nextCursor)
        streamsInflight++

        const reqStream = await startStream(options, parsedChunk.nextCursor)
        reqStream.on('end', () => {
          streamsInflight--
          if (streamsInflight === 0) {
            stream.end()
          }
        })
        reqStream.pipe(this, {end: false})

        callback()
        return
      }

      callback(null, chunk)
    },
  })

  streamsInflight++
  const reqStream = await startStream(options, '')
  reqStream.on('end', () => {
    streamsInflight--
    if (streamsInflight === 0) {
      stream.end()
    }
  })

  reqStream.pipe(stream, {end: false})
  return stream
}

function startStream(options, nextCursor) {
  const url = options.client.getUrl(
    `/data/export/${options.dataset}?nextCursor=${encodeURIComponent(nextCursor)}`,
  )
  const token = options.client.config().token
  const headers = {
    'User-Agent': `${pkg.name}@${pkg.version}`,
    ...(token ? {Authorization: `Bearer ${token}`} : {}),
  }

  debug('Starting stream with cursor "%s"', nextCursor)

  return requestStream({url, headers, maxRetries: options.maxRetries}).then((res) => {
    debug('Got stream with HTTP %d', res.statusCode)

    return res
  })
}
