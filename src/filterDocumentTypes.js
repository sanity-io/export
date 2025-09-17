import miss from 'mississippi'

export const filterDocumentTypes = (allowedTypes) =>
  allowedTypes && allowedTypes.length > 0
    ? miss.through.obj((doc, enc, callback) => {
        const type = doc && doc._type
        if (allowedTypes.includes(type)) {
          callback(null, doc)
          return
        }

        callback()
      })
    : miss.through.obj()
