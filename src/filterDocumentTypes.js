import {throughObj} from './util/streamHelpers.js'

export function filterDocumentTypes(allowedTypes) {
  if (!allowedTypes || allowedTypes.length === 0) {
    // Pass-through
    return throughObj((doc, enc, callback) => callback(null, doc))
  }

  return throughObj(function docTypesFilter(doc, enc, callback) {
    const type = doc && doc._type
    if (allowedTypes.includes(type)) {
      callback(null, doc)
      return
    }

    callback()
  })
}
