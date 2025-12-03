import {debug} from './debug.js'
import {through} from './util/streamHelpers.js'

export function logFirstChunk() {
  let firstChunk = true
  return through((chunk, enc, callback) => {
    if (firstChunk) {
      const string = chunk.toString('utf8').split('\n')[0]
      debug('First chunk received: %s', string.slice(0, 300))
      firstChunk = false
    }

    callback(null, chunk)
  })
}
