import {createServer, type RequestListener} from 'node:http'

export interface ServerHandle {
  port: number
  close: () => Promise<void>
}

export function getServer(onRequest: RequestListener): Promise<ServerHandle> {
  const server = createServer(onRequest)

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    // Bind directly to an available port, avoiding a race between finding and using it.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Expected the test server to listen on a TCP port'))
        return
      }

      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()))
          }),
      })
    })
  })
}
