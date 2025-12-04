import type {Transform} from 'node:stream'

import {throughObj} from './util/streamHelpers.js'
import {debug} from './debug.js'
import type {SanityDocument} from './types.js'

interface CursorDocument {
  nextCursor?: string
}

const isDraftOrVersion = (doc: SanityDocument): boolean =>
  Boolean(doc._id && (doc._id.indexOf('drafts.') === 0 || doc._id.indexOf('versions.') === 0))

const isSystemDocument = (doc: SanityDocument): boolean =>
  Boolean(doc._id && doc._id.indexOf('_.') === 0)

const isReleaseDocument = (doc: SanityDocument): boolean =>
  Boolean(doc._id && doc._id.indexOf('_.releases.') === 0)

const isCursor = (doc: unknown): doc is CursorDocument =>
  typeof doc === 'object' &&
  doc !== null &&
  !('_id' in doc) &&
  'nextCursor' in doc &&
  (doc as CursorDocument).nextCursor !== undefined

export function filterDocuments(drafts: boolean): Transform {
  return throughObj(function filterDocs(doc: SanityDocument | CursorDocument, _enc, callback) {
    if (isCursor(doc)) {
      debug('%o is a cursor, skipping', doc)
      callback()
      return
    }

    const sanityDoc = doc

    if (!drafts && isDraftOrVersion(sanityDoc)) {
      debug('%s is a draft or version, skipping', sanityDoc._id)
      callback()
      return
    }

    if (isSystemDocument(sanityDoc)) {
      if (drafts && isReleaseDocument(sanityDoc)) {
        callback(null, sanityDoc)
        return
      }
      debug('%s is a system document, skipping', sanityDoc._id)
      callback()
      return
    }

    callback(null, sanityDoc)
  })
}
