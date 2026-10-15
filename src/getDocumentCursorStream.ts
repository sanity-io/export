import {Readable} from 'node:stream'

import {getUserAgent} from './getUserAgent.js'
import {requestStream} from './requestStream.js'
import type {NormalizedExportOptions, ResponseStream} from './types.js'
import {getSource} from './options.js'

export async function getDocumentCursorStream(options: NormalizedExportOptions): Promise<Readable> {
  return Readable.from(readPages(options))
}

async function* readPages(options: NormalizedExportOptions) {
  let cursor = ''
  const seenCursors = new Set<string>()
  do {
    const response = await startStream(options, cursor)
    let pending = ''
    let nextCursor = ''
    const readCursor = (line: string) => {
      try {
        const value = JSON.parse(line) as {_id?: string; nextCursor?: string}
        if (value && !value._id && typeof value.nextCursor === 'string')
          nextCursor = value.nextCursor
      } catch {
        // Document parsing and API errors are handled by the export pipeline.
      }
    }
    for await (const chunk of response) {
      pending += String(chunk)
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) readCursor(line)
      yield chunk
    }
    if (pending) {
      readCursor(pending)
      yield Buffer.from('\n')
    }
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error(
        'Export returned a repeated page cursor. Retry the export or use stream mode.',
      )
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor)
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
  if (options.types?.length) url.searchParams.set('types', options.types.join())
  const token = options.client.config().token
  return requestStream({
    url: url.toString(),
    headers: {'User-Agent': getUserAgent(), ...(token && {Authorization: `Bearer ${token}`})},
    maxRetries: options.maxRetries,
    ...(options.signal && {signal: options.signal}),
    ...(options.retryDelayMs !== undefined && {retryDelayMs: options.retryDelayMs}),
    readTimeout: options.readTimeout,
  })
}
