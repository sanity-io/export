import {Readable} from 'node:stream'

import type {AssetMap} from './types.js'

/**
 * Serialize the asset map one entry at a time, so large exports don't require a
 * single JSON string for the whole map. Each entry comes from one document.
 * Readable.from handles backpressure and forwards serialization errors.
 */
export function stringifyAssetMap(assetMap: AssetMap): Readable {
  return Readable.from(entries(), {objectMode: false})

  function* entries(): Generator<string> {
    yield '{'
    let separator = ''

    for (const id in assetMap) {
      if (!Object.hasOwn(assetMap, id)) continue

      const metadata = JSON.stringify(assetMap[id])
      if (metadata === undefined) continue

      yield `${separator}${JSON.stringify(id)}:${metadata}`
      separator = ','
    }

    yield '}'
  }
}
