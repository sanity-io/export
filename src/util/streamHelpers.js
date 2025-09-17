import {Transform} from 'node:stream'

export const through = (transformFn) => {
  return new Transform({
    transform(chunk, encoding, callback) {
      transformFn(chunk, encoding, callback)
    },
  })
}

export const throughObj = (transformFn) => {
  return new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      transformFn(chunk, encoding, callback)
    },
  })
}

export const concat = (onData) => {
  const chunks = []
  return new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      chunks.push(chunk)
      callback()
    },
    flush(callback) {
      try {
        onData(chunks)
        callback()
      } catch (err) {
        callback(err)
      }
    },
  })
}

export const split = (transformFn) => {
  let buffer = ''
  const splitRegex = /\r?\n/

  return new Transform({
    objectMode: !!transformFn,
    transform(chunk, encoding, callback) {
      buffer += chunk.toString()
      const lines = buffer.split(splitRegex)

      // Keep the last line in buffer as it might be incomplete
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.length === 0) continue

        if (transformFn) {
          try {
            const result = transformFn(line)
            if (result !== undefined) {
              this.push(result)
            }
          } catch (err) {
            return callback(err)
          }
        } else {
          this.push(line)
        }
      }
      callback()
    },
    flush(callback) {
      if (buffer.length > 0) {
        if (transformFn) {
          try {
            const result = transformFn(buffer)
            if (result !== undefined) {
              this.push(result)
            }
          } catch (err) {
            return callback(err)
          }
        } else {
          this.push(buffer)
        }
      }
      callback()
    },
  })
}
