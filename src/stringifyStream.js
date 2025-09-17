import miss from 'mississippi'

export const stringifyStream = () =>
  miss.through.obj((doc, enc, callback) => callback(null, `${JSON.stringify(doc)}\n`))
