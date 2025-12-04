import type {Transform} from 'node:stream'

import {throughObj} from './util/streamHelpers.js'
import type {SanityDocument} from './types.js'

interface ErrorDocument {
  _id?: undefined
  error:
    | string
    | {
        description?: string
        message?: string
      }
  message?: string
  statusCode?: number
}

type DocumentOrError = SanityDocument | ErrorDocument

function isErrorDocument(doc: DocumentOrError): doc is ErrorDocument {
  return !('_id' in doc && doc._id) && 'error' in doc
}

export function rejectOnApiError(): Transform {
  return throughObj((doc: DocumentOrError, _enc, callback) => {
    // check if the document passed contains a document attribute first, and return early.
    if ('_id' in doc && doc._id) {
      callback(null, doc)
      return
    }

    if (isErrorDocument(doc)) {
      // if we got a statusCode we can decorate the error with it
      if (doc.statusCode) {
        const err = doc.error
        const errorMessage =
          typeof err === 'string'
            ? err
            : typeof err === 'object'
              ? (err.description ?? err.message)
              : undefined
        callback(
          new Error(
            ['Export', `HTTP ${doc.statusCode}`, errorMessage, doc.message]
              .filter((part): part is string => typeof part === 'string')
              .join(': '),
          ),
        )
        return
      }

      // no statusCode, just serialize and return the error
      const error = doc.error
      const errorMessage =
        typeof error === 'object' ? (error.description ?? error.message) : undefined
      callback(new Error(errorMessage ?? JSON.stringify(doc)))
      return
    }

    callback(null, doc)
  })
}
