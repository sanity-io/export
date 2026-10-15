import {setTimeout as delay} from 'node:timers/promises'

import type {AssetHandler} from './AssetHandler.js'
import {DEFAULT_RETRY_DELAY} from './constants.js'
import {getUserAgent} from './getUserAgent.js'
import {requestStream} from './requestStream.js'
import type {AssetDocument, NormalizedExportOptions} from './types.js'

const BATCH_SIZE = 50

export async function downloadReferencedAssets(
  handler: AssetHandler,
  options: NormalizedExportOptions,
): Promise<void> {
  let batch: string[] = []
  for (const id of handler.requiredAssets.keys()) {
    if (handler.assetsSeen.has(id)) continue
    batch.push(id)
    if (batch.length === BATCH_SIZE) {
      await downloadBatch(batch, handler, options)
      batch = []
    }
  }
  if (batch.length) await downloadBatch(batch, handler, options)
}

async function downloadBatch(
  ids: string[],
  handler: AssetHandler,
  options: NormalizedExportOptions,
): Promise<void> {
  const signal = handler.abortController.signal
  // Dataset image/file references are distinct from Media Library asset documents.
  if (!('dataset' in options)) {
    return
  }
  const url = options.client.getUrl(
    `/data/doc/${options.dataset}/${ids.map(encodeURIComponent).join(',')}`,
  )
  const headers = {
    'User-Agent': getUserAgent(),
    Authorization: `Bearer ${options.client.config().token}`,
  }
  const attempts = Math.max(1, options.maxRetries)
  let documents: AssetDocument[] = []
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal.throwIfAborted()
    const response = await requestStream({
      url,
      headers,
      signal,
      maxRetries: options.maxRetries,
      readTimeout: options.readTimeout,
      ...(options.retryDelayMs !== undefined && {retryDelayMs: options.retryDelayMs}),
    })
    const chunks: Buffer[] = []
    for await (const chunk of response) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    if (response.statusCode !== 200) {
      if ([401, 403, 404].includes(response.statusCode ?? 0)) {
        console.warn(
          '⚠ Asset lookup failed with HTTP %d (ignoring): %s',
          response.statusCode,
          ids.join(', '),
        )
        return
      }
      if (
        (response.statusCode === 429 || (response.statusCode ?? 0) >= 500) &&
        attempt + 1 < attempts
      ) {
        await delay(options.retryDelayMs ?? DEFAULT_RETRY_DELAY, undefined, {signal})
        continue
      }
      throw new Error(
        `Could not retrieve referenced assets (HTTP ${response.statusCode}). Check dataset access and retry the export.`,
      )
    }
    let result: {documents?: AssetDocument[]}
    try {
      result = JSON.parse(body) as typeof result
      if (!Array.isArray(result?.documents)) throw new Error('Missing documents')
    } catch (cause) {
      throw new Error(
        'Could not read the referenced asset documents. Retry the export; if this continues, contact Sanity support.',
        {cause},
      )
    }
    documents = result.documents
    break
  }
  for (const id of ids) {
    const doc = documents.find((document) => document?._id === id)
    const expectedType = id.startsWith('image-') ? 'sanity.imageAsset' : 'sanity.fileAsset'
    if (!doc || doc._type !== expectedType) {
      console.warn(
        `Asset "${id}" referenced by document "${handler.requiredAssets.get(id)}" is missing or inaccessible and was skipped. Restore the asset or repair the reference before importing.`,
      )
      continue
    }
    handler.addAsset(doc)
    signal.throwIfAborted()
  }
}
