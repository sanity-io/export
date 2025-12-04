import {Transform, type TransformCallback} from 'node:stream'

import {debug} from './debug.js'
import {getUserAgent} from './getUserAgent.js'
import {requestStream} from './requestStream.js'
import type {NormalizedExportOptions, ResponseStream} from './types.js'
import {getSource} from './options.js'

// same regex as split2 is using by default: https://github.com/mcollina/split2/blob/53432f54bd5bf422bd55d91d38f898b6c9496fc1/index.js#L86
const splitRegex = /\r?\n/

interface CursorChunk {
  nextCursor?: string
  _id?: string
}

export async function getDocumentCursorStream(
  options: NormalizedExportOptions,
): Promise<Transform> {
  let streamsInflight = 0
  function decrementInflight(stream: Transform): void {
    streamsInflight--
    if (streamsInflight === 0) {
      stream.end()
    }
  }

  const stream = new Transform({
    transform(
      this: Transform,
      chunk: Buffer,
      encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      if (encoding !== ('buffer' as BufferEncoding) && encoding !== ('string' as BufferEncoding)) {
        callback(null, chunk)
        return
      }
      this.push(chunk, encoding)

      let parsedChunk: CursorChunk | null = null
      for (const chunkStr of chunk.toString().split(splitRegex)) {
        if (chunkStr.trim() === '') {
          continue
        }

        try {
          parsedChunk = JSON.parse(chunkStr) as CursorChunk
        } catch {
          // Ignore JSON parse errors
          // this can happen if the chunk is not a JSON object. We just pass it through and let the caller handle it.
          debug('Failed to parse JSON chunk, ignoring', chunkStr)
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

          void startStream(options, parsedChunk.nextCursor).then((reqStream) => {
            reqStream.on('end', () => decrementInflight(this))
            reqStream.pipe(this, {end: false})
          })
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

function startStream(
  options: NormalizedExportOptions,
  nextCursor: string,
): Promise<ResponseStream> {
  const source = getSource(options)
  const baseUrl = options.client.getUrl(
    source.type === 'dataset'
      ? `/data/export/${source.id}`
      : `/media-libraries/${source.id}/export`,
  )

  const url = new URL(baseUrl)
  url.searchParams.set('nextCursor', nextCursor)

  if (options.types && options.types.length > 0) {
    url.searchParams.set('types', options.types.join())
  }
  const token = options.client.config().token
  const headers: Record<string, string> = {
    'User-Agent': getUserAgent(),
    ...(token ? {Authorization: `Bearer ${token}`} : {}),
  }

  debug('Starting stream with cursor "%s"', nextCursor)

  return requestStream({
    url: url.toString(),
    headers,
    maxRetries: options.maxRetries,
    ...(options.retryDelayMs !== undefined ? {retryDelayMs: options.retryDelayMs} : {}),
    readTimeout: options.readTimeout,
  }).then((res) => {
    debug('Got stream with HTTP %d', res.statusCode)

    return res
  })
}
