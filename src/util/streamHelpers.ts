import {Transform, type TransformCallback, type Writable} from 'node:stream'
import {StringDecoder} from 'node:string_decoder'

type TransformFunction = (
  chunk: Buffer,
  encoding: BufferEncoding,
  callback: TransformCallback,
) => void

type TransformObjFunction<T, R> = (
  chunk: T,
  encoding: BufferEncoding,
  callback: TransformCallback,
) => R

export function through(transformFn: TransformFunction): Transform {
  return new Transform({
    transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
      transformFn(chunk, encoding, callback)
    },
  })
}

export function throughObj<T = unknown, R = void>(
  transformFn: TransformObjFunction<T, R>,
): Transform {
  return new Transform({
    objectMode: true,
    transform(chunk: T, encoding: BufferEncoding, callback: TransformCallback) {
      transformFn(chunk, encoding, callback)
    },
  })
}

export function isWritableStream(val: unknown): val is Writable {
  return (
    val !== null &&
    typeof val === 'object' &&
    'pipe' in val &&
    typeof val.pipe === 'function' &&
    '_write' in val &&
    typeof val._write === 'function' &&
    '_writableState' in val &&
    typeof val._writableState === 'object'
  )
}

export function concat(onData: (chunks: unknown[]) => void): Transform {
  const chunks: unknown[] = []
  return new Transform({
    objectMode: true,
    transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      chunks.push(chunk)
      callback()
    },
    flush(callback: TransformCallback) {
      try {
        onData(chunks)
        callback()
      } catch (err) {
        callback(err as Error)
      }
    },
  })
}

export function split(transformFn?: (line: string) => unknown): Transform {
  let buffer = ''
  const splitRegex = /\r?\n/
  const decoder = new StringDecoder('utf8')

  return new Transform({
    objectMode: Boolean(transformFn),
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      buffer += decoder.write(chunk)
      const lines = buffer.split(splitRegex)

      // Keep the last line in buffer as it might be incomplete
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.length === 0) continue

        if (transformFn) {
          try {
            const result = transformFn(line)
            if (result !== undefined) {
              this.push(result)
            }
          } catch (err) {
            callback(err as Error)
            return
          }
        } else {
          this.push(line)
        }
      }
      callback()
    },
    flush(callback: TransformCallback) {
      // Flush any remaining bytes from the decoder
      buffer += decoder.end()

      if (buffer.length === 0) {
        callback()
        return
      }

      if (!transformFn) {
        callback(null, buffer)
        return
      }

      try {
        const result = transformFn(buffer)
        if (result !== undefined) {
          this.push(result)
        }
        callback()
      } catch (err) {
        callback(err as Error)
      }
    },
  })
}
