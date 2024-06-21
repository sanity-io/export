const miss = require('mississippi')

module.exports = () =>
  miss.through.obj((doc, enc, callback) => {
    // check if the document passed contains a document attribtue first, and return early.
    if (doc._id) {
      callback(null, doc)
      return
    }

    if (doc.error) {
      // if we got a statusCode we can decorate the error with it
      if (doc.statusCode) {
        callback(
          new Error(
            ['Export', `HTTP ${doc.statusCode}`, doc.error, doc.message]
              .filter((part) => typeof part === 'string')
              .join(': '),
          ),
        )
        return
      }

      // no statusCode, just serialize and return the error
      callback(new Error(doc.error.description || doc.error.message || JSON.stringify(doc)))
      return
    }

    callback(null, doc)
  })
