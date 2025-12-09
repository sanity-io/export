import type {Transform} from 'node:stream'

import {throughObj} from './util/streamHelpers.js'

export function stringifyStream(): Transform {
  return throughObj((doc: unknown, _enc, callback) => callback(null, `${JSON.stringify(doc)}\n`))
}
