const miss = require('mississippi')
const debug = require('./debug')

const isDraftOrVersion = (doc) => doc && doc._id && (
  doc._id.indexOf('drafts.') === 0 ||
  doc._id.indexOf('versions.') === 0
)

const isSystemDocument = (doc) => doc && doc._id && doc._id.indexOf('_.') === 0
const isReleaseDocument = (doc) => doc && doc._id && doc._id.indexOf('_.releases.') === 0
const isCursor = (doc) => doc && !doc._id && doc.nextCursor !== undefined

module.exports = (drafts) =>
  miss.through.obj((doc, enc, callback) => {
    if (isCursor(doc)) {
      debug('%o is a cursor, skipping', doc)
      return callback()
    }

    if (!drafts && isDraftOrVersion(doc)) {
      debug('%s is a draft or version, skipping', doc && doc._id)
      return callback()
    }

    if (isSystemDocument(doc)) {
      if (!drafts && isReleaseDocument(doc)) {
        return callback(null, doc)
      }
      debug('%s is a system document, skipping', doc && doc._id)
      return callback()
    }

    return callback(null, doc)
  })