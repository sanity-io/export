import {throughObj} from './util/streamHelpers.js'

export function stringifyStream() {
  return throughObj((doc, enc, callback) => callback(null, `${JSON.stringify(doc)}\n`))
}
