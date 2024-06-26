const {Transform} = require('node:stream')

const pkg = require('../package.json')
const requestStream = require('./requestStream')

module.exports = async (options) => {
  let streamsInflight = 0
  const stream = new Transform({
    async transform(chunk, encoding, callback) {
      if (encoding !== 'buffer' && encoding !== 'string') {
        callback(null, chunk)
        return
      }

      try {
        const parsedChunk = JSON.parse(chunk.toString())
        if (
          parsedChunk !== null &&
          typeof parsedChunk === 'object' &&
          'nextCursor' in parsedChunk &&
          typeof parsedChunk.nextCursor === 'string' &&
          !('_id' in parsedChunk)
        ) {
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
      } catch (err) {
        // Ignore JSON parse errors
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
  const url = options.client.getUrl(`/data/export/${options.dataset}?nextCursor=${nextCursor}`)
  const token = options.client.config().token
  const headers = {
    'User-Agent': `${pkg.name}@${pkg.version}`,
    ...(token ? {Authorization: `Bearer ${token}`} : {}),
  }

  return requestStream({url, headers, maxRetries: options.maxRetries})
}
