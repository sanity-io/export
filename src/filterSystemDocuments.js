const miss = require('mississippi')
const debug = require('./debug')

const isSystemDocument = (doc) => doc && doc._id && doc._id.indexOf('_.') === 0
const isCursor = (doc) => doc && !doc._id && doc.nextCursor !== undefined

module.exports = () =>
  miss.through.obj((doc, enc, callback) => {
    if (isSystemDocument(doc)) {
      debug('%s is a system document, skipping', doc && doc._id)
      return callback()
    }
    if (isCursor(doc)) {
      debug('%o is a cursor, skipping', doc)
      return callback()
    }

    return callback(null, doc)
  })
