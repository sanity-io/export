const {Transform} = require('node:stream')

const pkg = require('../package.json')
const debug = require('./debug')
const requestStream = require('./requestStream')

// same regex as split2 is using by default: https://github.com/mcollina/split2/blob/53432f54bd5bf422bd55d91d38f898b6c9496fc1/index.js#L86
const splitRegex = /\r?\n/

module.exports = async (options) => {
  let streamsInflight = 0
  function decrementInflight(stream) {
    streamsInflight--
    if (streamsInflight === 0) {
      stream.end()
    }
  }

  const stream = new Transform({
    async transform(chunk, encoding, callback) {
      if (encoding !== 'buffer' && encoding !== 'string') {
        callback(null, chunk)
        return
      }
      this.push(chunk, encoding)

      let parsedChunk = null
      for (const chunkStr of chunk.toString().split(splitRegex)) {
        if (chunkStr.trim() === '') {
          continue
        }

        try {
          parsedChunk = JSON.parse(chunkStr)
        } catch (err) {
          // Ignore JSON parse errors
          // this can happen if the chunk is not a JSON object. We just pass it through and let the caller handle it.
          debug('Failed to parse JSON chunk, ignoring', err, chunkStr)
        }

        if (
          parsedChunk !== null &&
          typeof parsedChunk === 'object' &&
          'nextCursor' in parsedChunk &&
          typeof parsedChunk.nextCursor === 'string' &&
          !('_id' in parsedChunk)
        ) {
          debug('Got next cursor "%s", fetching next stream', parsedChunk.nextCursor)
          streamsInflight++

          const reqStream = await startStream(options, parsedChunk.nextCursor)
          reqStream.on('end', () => decrementInflight(this))
          reqStream.pipe(this, {end: false})
        }
      }

      callback()
    },
  })

  streamsInflight++
  const reqStream = await startStream(options, '')
  reqStream.on('end', () => decrementInflight(stream))
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
