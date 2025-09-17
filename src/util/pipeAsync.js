import miss from 'mississippi'

export const pipeAsync = async (readable, writable) => {
  return new Promise((resolve, reject) => {
    try {
      miss.pipe(readable, writable, (jsonErr) => {
        if (jsonErr) {
          reject(jsonErr)
        } else {
          resolve()
        }
      })
    } catch (assetErr) {
      reject(assetErr)
    }
  })
}
