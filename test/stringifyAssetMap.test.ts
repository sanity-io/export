import {Writable} from 'node:stream'
import {text} from 'node:stream/consumers'
import {pipeline} from 'node:stream/promises'

import {expect, test} from 'vitest'

import {stringifyAssetMap} from '../src/stringifyAssetMap.js'
import type {AssetMap} from '../src/types.js'

test('serializes an empty asset map', async () => {
  expect(await text(stringifyAssetMap({}))).toBe('{}')
})

test('matches JSON.stringify for asset metadata, escaping and property order', async () => {
  const assetMap: AssetMap = {
    'image-abc': {
      originalFilename: 'a "quoted" filename\\with\nnewlines-😀.png',
      metadata: {dimensions: {width: 100, height: 200}, palette: [null, true, 1.5]},
      omitted: undefined,
    },
    'file-"\\\n😀': {description: '', tags: [], missing: null},
    'file-empty': {},
  }

  expect(await text(stringifyAssetMap(assetMap))).toBe(JSON.stringify(assetMap))
})

test('ignores inherited entries', async () => {
  const assetMap: AssetMap = Object.assign(Object.create({inherited: {title: 'ignore'}}), {
    'file-own': {title: 'include'},
  })

  expect(await text(stringifyAssetMap(assetMap))).toBe(JSON.stringify(assetMap))
})

test('forwards serialization errors through the stream', async () => {
  const metadata: Record<string, unknown> = {}
  metadata.circular = metadata

  await expect(text(stringifyAssetMap({'file-circular': metadata}))).rejects.toThrow(/circular/i)
})

test('stops serializing when the destination fails instead of reading the whole map', async () => {
  let serialized = 0
  const assetMap: AssetMap = {}
  for (let i = 0; i < 1000; i++) {
    Object.defineProperty(assetMap, `file-${i}`, {
      enumerable: true,
      get() {
        serialized++
        return {description: 'x'.repeat(4096)}
      },
    })
  }

  const destination = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      setImmediate(() => callback(new Error('disk full')))
    },
  })
  const source = stringifyAssetMap(assetMap)

  await expect(pipeline(source, destination)).rejects.toThrow('disk full')
  expect(serialized).toBeLessThan(1000)
  expect(source.destroyed).toBe(true)
})
