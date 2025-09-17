import {throughObj} from './util/streamHelpers.js'

export const filterDocumentTypes = (allowedTypes) =>
  allowedTypes && allowedTypes.length > 0
    ? throughObj((doc, enc, callback) => {
        const type = doc && doc._type
        if (allowedTypes.includes(type)) {
          callback(null, doc)
          return
        }

        callback()
      })
    : throughObj((doc, enc, callback) => callback(null, doc))
