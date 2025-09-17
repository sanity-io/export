import {throughObj} from './util/streamHelpers.js'

export const stringifyStream = () =>
  throughObj((doc, enc, callback) => callback(null, `${JSON.stringify(doc)}\n`))
