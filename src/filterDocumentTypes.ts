import type {Transform} from 'node:stream'

import {throughObj} from './util/streamHelpers.js'
import type {SanityDocument} from './types.js'

export function filterDocumentTypes(allowedTypes: string[] | undefined): Transform {
  if (!allowedTypes || allowedTypes.length === 0) {
    // Pass-through
    return throughObj((doc: SanityDocument, _enc, callback) => callback(null, doc))
  }

  return throughObj(function docTypesFilter(doc: SanityDocument, _enc, callback) {
    const type = doc._type
    if (allowedTypes.includes(type)) {
      callback(null, doc)
      return
    }

    callback()
  })
}
