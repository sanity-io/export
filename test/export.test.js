const os = require('os')
const http = require('http')
const {join: joinPath} = require('path')
const {createReadStream} = require('fs')
const {mkdir, rm} = require('fs/promises')
const {afterAll, describe, expect, test, afterEach} = require('@jest/globals')

const exportDataset = require('../src/export')
const {MODE_CURSOR} = require('../src/constants')
const {assertContents} = require('./helpers')

const OUTPUT_ROOT_DIR = joinPath(os.tmpdir(), 'sanity-export-tests')

const getMockClient = (port) => ({
  getUrl: (path) => `http://localhost:${port}${path}`,
  config: () => ({token: 'skSomeToken', projectId: 'projectId'}),
})

const getOptions = async ({port, maxRetries = 2, types, ...rest}) => {
  const randomPath = (Math.random() + 1).toString(36).substring(7)
  const outputDir = joinPath(OUTPUT_ROOT_DIR, randomPath)
  const outputPath = joinPath(outputDir, 'out.tar.gz')
  await mkdir(outputDir, {recursive: true})
  return {
    dataset: 'source',
    client: getMockClient(port),
    outputPath,
    maxRetries,
    types,
    ...rest,
  }
}

const getServer = (port, onRequest) => {
  const server = http.createServer(onRequest)

  function close() {
    return new Promise((success, fail) => {
      server.close((err) => {
        if (err) {
          fail(err)
        } else {
          success()
        }
      })
    })
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({close})
    })
  })
}

afterAll(async () => {
  await rm(OUTPUT_ROOT_DIR, {recursive: true})
})

describe('export', () => {
  let server

  afterEach(async () => {
    if (server) {
      await server.close()
      server = null
    }
  })

  test('skips system documents', async () => {
    const port = 43213
    server = await getServer(port, (req, res) => {
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      res.end(
        JSON.stringify({
          _id: '_.groups.blatti',
          _type: 'system.group',
          title: 'Blatti',
        }),
      )
    })
    const options = await getOptions({port})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 0,
      documentCount: 0,
      outputPath: /out\.tar\.gz$/,
    })
  })

  test('can skip provided types', async () => {
    const port = 43214
    const doc = {
      _id: 'this-is-my-jam',
      _type: 'i-want-this',
      title: 'Please include me',
    }

    server = await getServer(port, (req, res) => {
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      res.write(
        JSON.stringify({
          _id: 'foo.bar.baz',
          _type: 'not-what-i-want',
          title: 'Do not include me',
        }),
      )
      res.write('\n')
      res.write(JSON.stringify(doc))
      res.end()
    })
    const options = await getOptions({port, types: ['i-want-this']})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 0,
      documentCount: 1,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents: [doc],
    })
  })

  test('successfully exports a (very) small dataset', async () => {
    const port = 43215
    const documents = [
      {
        _id: 'first-but-not-the-only',
        _type: 'article',
        title: 'Hello, world!',
      },
      {
        _id: 'second-and-last',
        _type: 'article',
        title: 'Goodbye, cruel world!',
      },
    ]
    server = await getServer(port, (req, res) => {
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      res.write(JSON.stringify(documents[0]))
      res.write('\n')
      res.write(JSON.stringify(documents[1]))
      res.end()
    })
    const options = await getOptions({port})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 0,
      documentCount: 2,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents,
    })
  })

  test('includes assets with custom metadata in default mode', async () => {
    const port = 43216
    const doc = {
      _id: 'my-article',
      _type: 'article',
      title: 'Nice logo',
      mainImage: {
        _ref: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
        _type: 'reference',
      },
      someFile: {
        _ref: 'file-497d1ba975eae4283a4e8906e3cb434110361f64-txt',
        _type: 'reference',
      },
    }

    server = await getServer(port, (req, res) => {
      if (req.url.startsWith('/images')) {
        res.writeHead(200, 'OK', {'Content-Type': 'image/png'})
        createReadStream(joinPath(__dirname, 'fixtures', 'mead.png')).pipe(res)
        return
      }
      if (req.url.startsWith('/files')) {
        res.writeHead(200, 'OK', {'Content-Type': 'text/plain'})
        createReadStream(joinPath(__dirname, 'fixtures', 'coffee.txt')).pipe(res)
        return
      }
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      res.write(
        JSON.stringify({
          _id: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
          _type: 'sanity.imageAsset',
          url: `http://localhost:${port}/images/ppsg7ml5/test/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png`,
          path: 'images/ppsg7ml5/test/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png',
          originalFilename: 'mead.png',
          altText: 'Logo of mead',
        }),
      )
      res.write('\n')
      res.write(
        JSON.stringify({
          _id: 'file-497d1ba975eae4283a4e8906e3cb434110361f64-txt',
          _type: 'sanity.fileAsset',
          url: `http://localhost:${port}/files/ppsg7ml5/test/497d1ba975eae4283a4e8906e3cb434110361f64.txt`,
          path: 'files/ppsg7ml5/test/497d1ba975eae4283a4e8906e3cb434110361f64.txt',
          originalFilename: 'coffee.txt',
        }),
      )
      res.write('\n')
      res.write(JSON.stringify(doc))
      res.end()
    })
    const options = await getOptions({port})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 2,
      documentCount: 1,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents: [doc],
      images: {
        'eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png': {
          altText: 'Logo of mead',
          originalFilename: 'mead.png',
        },
      },
      files: {
        '497d1ba975eae4283a4e8906e3cb434110361f64.txt': {
          originalFilename: 'coffee.txt',
        },
      },
    })
  })

  test('retries asset downloads on server error', async () => {
    const port = 43216
    const doc = {
      _id: 'my-article',
      _type: 'article',
      title: 'Nice logo',
      mainImage: {
        _ref: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
        _type: 'reference',
      },
    }

    let attempt = 0
    server = await getServer(port, (req, res) => {
      if (req.url.startsWith('/images')) {
        if (++attempt === 1) {
          res.writeHead(500, 'Internal Server Error', {'Content-Type': 'application/json'})
          res.end(JSON.stringify({error: 'Server error'}))
          return
        }
        res.writeHead(200, 'OK', {'Content-Type': 'image/png'})
        createReadStream(joinPath(__dirname, 'fixtures', 'mead.png')).pipe(res)
        return
      }
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      res.write(
        JSON.stringify({
          _id: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
          _type: 'sanity.imageAsset',
          url: `http://localhost:${port}/images/ppsg7ml5/test/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png`,
          path: 'images/ppsg7ml5/test/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png',
          originalFilename: 'mead.png',
          altText: 'Logo of mead',
        }),
      )
      res.write('\n')
      res.write(
        JSON.stringify({
          _id: 'file-497d1ba975eae4283a4e8906e3cb434110361f64-txt',
          _type: 'sanity.fileAsset',
          url: `http://localhost:${port}/files/ppsg7ml5/test/497d1ba975eae4283a4e8906e3cb434110361f64.txt`,
          path: 'files/ppsg7ml5/test/497d1ba975eae4283a4e8906e3cb434110361f64.txt',
          originalFilename: 'coffee.txt',
        }),
      )
      res.write('\n')
      res.write(JSON.stringify(doc))
      res.end()
    })
    const options = await getOptions({port})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 2,
      documentCount: 1,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents: [doc],
      images: {
        'eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png': {
          altText: 'Logo of mead',
          originalFilename: 'mead.png',
        },
      },
      files: {
        '497d1ba975eae4283a4e8906e3cb434110361f64.txt': {
          originalFilename: 'coffee.txt',
        },
      },
    })
  })

  test('includes asset documents verbatim in `raw` mode', async () => {
    const port = 43216
    const doc = {
      _id: 'my-article',
      _type: 'article',
      title: 'Nice logo',
      mainImage: {
        _ref: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
        _type: 'reference',
      },
    }

    const assetDoc = {
      _id: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
      _type: 'sanity.imageAsset',
      url: `http://localhost:${port}/images/ppsg7ml5/test/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png`,
      path: 'images/ppsg7ml5/test/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png',
      originalFilename: 'mead.png',
      altText: 'Logo of mead',
    }

    server = await getServer(port, (req, res) => {
      if (req.url.startsWith('/images')) {
        res.writeHead(200, 'OK', {'Content-Type': 'image/png'})
        createReadStream(joinPath(__dirname, 'fixtures', 'mead.png')).pipe(res)
        return
      }
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      res.write(JSON.stringify(assetDoc))
      res.write('\n')
      res.write(JSON.stringify(doc))
      res.end()
    })
    const options = await getOptions({port, raw: true})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 0,
      documentCount: 2,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents: [doc, assetDoc],
      images: {},
    })
  })

  test('can exclude assets if specified', async () => {
    const port = 43216
    const doc = {
      _id: 'my-article',
      _type: 'article',
      title: 'Nice logo',
      mainImage: {
        _ref: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
        _type: 'reference',
      },
    }

    server = await getServer(port, (req, res) => {
      if (req.url.startsWith('/images')) {
        res.writeHead(200, 'OK', {'Content-Type': 'image/png'})
        createReadStream(joinPath(__dirname, 'fixtures', 'mead.png')).pipe(res)
        return
      }
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      res.write(
        JSON.stringify({
          _id: 'image-eca53d85ec83704801ead6c8be368fd377f8aaef-512x512-png',
          _type: 'sanity.imageAsset',
          url: `http://localhost:${port}/images/ppsg7ml5/test/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png`,
          path: 'images/ppsg7ml5/test/eca53d85ec83704801ead6c8be368fd377f8aaef-512x512.png',
          originalFilename: 'mead.png',
          altText: 'Logo of mead',
        }),
      )
      res.write('\n')
      res.write(JSON.stringify(doc))
      res.end()
    })
    const options = await getOptions({port, assets: false})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 0,
      documentCount: 1,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents: [doc],
      images: {},
      files: {},
    })
  })

  test('can exclude drafts if specified', async () => {
    const port = 43217
    const doc = {
      _id: 'my-article',
      _type: 'article',
      title: 'Nice logo',
    }
    const draftDoc = {
      _id: 'drafts.my-article',
      _type: 'article',
      title: 'Nicer logo',
    }

    server = await getServer(port, (req, res) => {
      if (req.url.startsWith('/images')) {
        res.writeHead(200, 'OK', {'Content-Type': 'image/png'})
        createReadStream(joinPath(__dirname, 'fixtures', 'mead.png')).pipe(res)
        return
      }
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      res.write(JSON.stringify(draftDoc))
      res.write('\n')
      res.write(JSON.stringify(doc))
      res.end()
    })
    const options = await getOptions({port, drafts: false})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 0,
      documentCount: 1,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents: [doc],
      images: {},
      files: {},
    })
  })

  test('throws error if unable to reach api', async () => {
    const options = await getOptions({port: 43210})
    await expect(() => exportDataset(options)).rejects.toThrow(/Failed to fetch/)
  }, 15000)

  test('throws error if api responds with 5xx error consistently', async () => {
    const port = 43211
    server = await getServer(port, (req, res) => {
      res.writeHead(500, 'Internal Server Error', {'Content-Type': 'application/json'})
      res.end(
        JSON.stringify({
          error: 'Some Server Error',
          message: 'Failed to stream from database',
          statusCode: 500,
        }),
      )
    })
    const options = await getOptions({port})
    await expect(() => exportDataset(options)).rejects.toThrowError(
      'Export: HTTP 500: Some Server Error: Failed to stream from database',
    )
  })

  test('throws error if api responds with 400 error', async () => {
    const port = 43212
    server = await getServer(port, (req, res) => {
      res.writeHead(400, 'Bad Request', {'Content-Type': 'application/json'})
      res.end(
        JSON.stringify({
          error: 'Bad Request',
          message: '`@sanity/export` version too old, please update',
          statusCode: 400,
        }),
      )
    })
    const options = await getOptions({port})
    await expect(() => exportDataset(options)).rejects.toThrowError(
      'Export: HTTP 400: Bad Request: `@sanity/export` version too old, please update',
    )
  })

  test('can export error like documents', async () => {
    const port = 43217
    const doc = {
      _id: 'my-article',
      _type: 'article',
      error: 'my error',
      statusCode: 500,
    }

    server = await getServer(port, (req, res) => {
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      res.write(JSON.stringify(doc))
      res.end()
    })
    const options = await getOptions({port, drafts: false})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 0,
      documentCount: 1,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents: [doc],
      images: {},
      files: {},
    })
  })

  test('export mode must be either cursor or stream', async () => {
    const options = await getOptions({mode: 'murg'})
    await expect(exportDataset(options)).rejects.toThrow(
      'options.mode must be either "stream" or "cursor", got "murg"',
    )
  })

  test('can export with cursor, multiple cursors', async () => {
    const port = 43215
    const documents = [
      {
        _id: 'first',
        _type: 'article',
        title: 'Hello, world!',
      },
      {
        _id: 'second',
        _type: 'article',
        title: 'Goodbye, cruel world!',
      },
      {
        _id: 'third-but-not-the-last',
        _type: 'article',
        title: 'Hello again, \r\nworld!',
      },
      {
        _id: 'fourth-and-last',
        _type: 'article',
        title: 'Goodbye again, cruel world!',
      },
    ]
    server = await getServer(port, (req, res) => {
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      const url = new URL(req.url, `http://localhost:${port}`)
      switch (url.searchParams.get('nextCursor')) {
        case '': {
          res.write(JSON.stringify(documents[0]))
          res.write('\n')
          res.write(JSON.stringify({nextCursor: 'cursor-1'}))
          res.write('\n')
          res.end()
          return
        }

        case 'cursor-1': {
          res.write(JSON.stringify(documents[1]))
          res.write('\n')
          res.write(JSON.stringify({nextCursor: 'cursor-2'}))
          res.write('\n')
          res.end()
          return
        }

        case 'cursor-2': {
          res.write(`${JSON.stringify(documents[2])}\n${JSON.stringify({nextCursor: 'cursor-3'})}`)
          res.write('\n')
          res.end()
          return
        }

        case 'cursor-3': {
          res.write(JSON.stringify(documents[3]))
          res.end()
          return
        }

        default: {
          throw new Error(`Unexpected cursor: ${req.query.nextCursor}`)
        }
      }
    })
    const options = await getOptions({port, mode: MODE_CURSOR})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 0,
      documentCount: 4,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents,
    })
  })
  test('can export with cursor, no cursor', async () => {
    const port = 43215
    const documents = [
      {
        _id: 'first',
        _type: 'article',
        title: 'Hello, world!',
      },
      {
        _id: 'second',
        _type: 'article',
        title: 'Goodbye, cruel world!',
      },
      {
        _id: 'third-but-not-the-last',
        _type: 'article',
        title: 'Hello again, world!',
      },
      {
        _id: 'fourth-and-last',
        _type: 'article',
        title: 'Goodbye again, cruel world!',
      },
    ]
    server = await getServer(port, (req, res) => {
      res.writeHead(200, 'OK', {'Content-Type': 'application/x-ndjson'})
      for (const document of documents) {
        res.write(JSON.stringify(document))
        res.write('\n')
      }
      res.end()
    })
    const options = await getOptions({port, mode: MODE_CURSOR})
    const result = await exportDataset(options)
    expect(result).toMatchObject({
      assetCount: 0,
      documentCount: 4,
      outputPath: /out\.tar\.gz$/,
    })

    await assertContents(result.outputPath, {
      documents,
    })
  })
})
