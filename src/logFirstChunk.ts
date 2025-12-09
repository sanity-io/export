import type {Transform} from 'node:stream'

import {through} from './util/streamHelpers.js'
import {debug} from './debug.js'

export function logFirstChunk(): Transform {
  let firstChunk = true
  return through((chunk, _enc, callback) => {
    if (firstChunk) {
      const string = chunk.toString('utf8').split('\n')[0]
      debug('First chunk received: %s', string?.slice(0, 300))
      firstChunk = false
    }

    callback(null, chunk)
  })
}
