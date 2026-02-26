import {describe, expect, test} from 'vitest'
import {PassThrough, Readable, Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'

import {concat, isWritableStream, split, through, throughObj} from '../src/util/streamHelpers.js'

describe('split', () => {
  test('handles multi-byte UTF-8 characters split across chunk boundaries', async () => {
    // "日本語" (Japanese) - each character is 3 bytes in UTF-8:
    // 日 = E6 97 A5 (bytes 10-12)
    // 本 = E6 9C AC (bytes 13-15)
    // 語 = E8 AA 9E (bytes 16-18)
    // Full: {"title":"日本語"}\n = 22 bytes
    const text = '{"title":"日本語"}\n'
    const fullBuffer = Buffer.from(text, 'utf8')

    // Split the buffer in the middle of the second character (本)
    // Split at byte 15: chunk1 gets bytes 0-14 (ending with 9c), chunk2 gets bytes 15+ (starting with ac)
    const splitPoint = 15
    const chunk1 = fullBuffer.subarray(0, splitPoint)
    const chunk2 = fullBuffer.subarray(splitPoint)

    // Verify we're actually splitting in the middle of a multi-byte char
    expect(chunk1[chunk1.length - 1]).toBe(0x9c) // Second byte of 本
    expect(chunk2[0]).toBe(0xac) // Third byte of 本

    const results: unknown[] = []
    const splitStream = split(JSON.parse)

    // Create a readable stream that emits our chunks
    const readable = new Readable({
      read() {
        this.push(chunk1)
        this.push(chunk2)
        this.push(null)
      },
    })

    splitStream.on('data', (chunk: unknown) => results.push(chunk))

    await pipeline(readable, splitStream)

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({title: '日本語'})
  })

  test('handles emoji split across chunk boundaries', async () => {
    // 🎉 (party popper) is 4 bytes in UTF-8: F0 9F 8E 89 (bytes 10-13)
    // Full: {"emoji":"🎉"}\n = 17 bytes
    const text = '{"emoji":"🎉"}\n'
    const fullBuffer = Buffer.from(text, 'utf8')

    // Split at byte 12: after F0 9F, before 8E 89
    const splitPoint = 12
    const chunk1 = fullBuffer.subarray(0, splitPoint)
    const chunk2 = fullBuffer.subarray(splitPoint)

    // Verify we're splitting in the middle of the emoji
    expect(chunk1[chunk1.length - 1]).toBe(0x9f) // Second byte of emoji
    expect(chunk2[0]).toBe(0x8e) // Third byte of emoji

    const results: unknown[] = []
    const splitStream = split(JSON.parse)

    const readable = new Readable({
      read() {
        this.push(chunk1)
        this.push(chunk2)
        this.push(null)
      },
    })

    splitStream.on('data', (chunk: unknown) => results.push(chunk))

    await pipeline(readable, splitStream)

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({emoji: '🎉'})
  })

  test('splits lines without transform function', async () => {
    const results: string[] = []
    const splitStream = split()

    const readable = Readable.from([Buffer.from('hello\nworld\n')])
    splitStream.on('data', (chunk: Buffer) => results.push(chunk.toString()))

    await pipeline(readable, splitStream)

    expect(results).toEqual(['hello', 'world'])
  })

  test('skips empty lines', async () => {
    const results: string[] = []
    const splitStream = split()

    const readable = Readable.from([Buffer.from('a\n\n\nb\n')])
    splitStream.on('data', (chunk: Buffer) => results.push(chunk.toString()))

    await pipeline(readable, splitStream)

    expect(results).toEqual(['a', 'b'])
  })

  test('handles Chinese characters at end of stream without trailing newline', async () => {
    // Test that flush also handles incomplete UTF-8 sequences
    // 中 = E4 B8 AD (bytes 9-11)
    // 文 = E6 96 87 (bytes 12-14)
    // Full: {"name":"中文"} = 17 bytes (no trailing newline)
    const text = '{"name":"中文"}'
    const fullBuffer = Buffer.from(text, 'utf8')

    // Split at byte 10: after E4, before B8 AD
    const splitPoint = 10
    const chunk1 = fullBuffer.subarray(0, splitPoint)
    const chunk2 = fullBuffer.subarray(splitPoint)

    expect(chunk1[chunk1.length - 1]).toBe(0xe4) // First byte of 中
    expect(chunk2[0]).toBe(0xb8) // Second byte of 中

    const results: unknown[] = []
    const splitStream = split(JSON.parse)

    const readable = new Readable({
      read() {
        this.push(chunk1)
        this.push(chunk2)
        this.push(null)
      },
    })

    splitStream.on('data', (chunk: unknown) => results.push(chunk))

    await pipeline(readable, splitStream)

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({name: '中文'})
  })
})

describe('through', () => {
  test('transforms buffer chunks', async () => {
    const upperCase = through((chunk, _enc, cb) => {
      cb(null, Buffer.from(chunk.toString().toUpperCase()))
    })

    const results: Buffer[] = []
    upperCase.on('data', (chunk: Buffer) => results.push(chunk))

    const readable = Readable.from([Buffer.from('hello'), Buffer.from('world')])
    await pipeline(readable, upperCase)

    expect(Buffer.concat(results).toString()).toBe('HELLOWORLD')
  })

  test('propagates errors via callback', async () => {
    const failing = through((_chunk, _enc, cb) => {
      cb(new Error('transform error'))
    })

    const readable = Readable.from([Buffer.from('data')])
    await expect(pipeline(readable, failing)).rejects.toThrow('transform error')
  })
})

describe('throughObj', () => {
  test('transforms objects in object mode', async () => {
    const doubler = throughObj((num: number, _enc, cb) => {
      cb(null, num * 2)
    })

    const results: unknown[] = []
    doubler.on('data', (chunk: unknown) => results.push(chunk))

    const readable = Readable.from([1, 2, 3])
    await pipeline(readable, doubler)

    expect(results).toEqual([2, 4, 6])
  })

  test('can filter by not passing value to callback', async () => {
    const evensOnly = throughObj((num: number, _enc, cb) => {
      if (num % 2 === 0) {
        cb(null, num)
      } else {
        cb()
      }
    })

    const results: unknown[] = []
    evensOnly.on('data', (chunk: unknown) => results.push(chunk))

    const readable = Readable.from([1, 2, 3, 4, 5])
    await pipeline(readable, evensOnly)

    expect(results).toEqual([2, 4])
  })
})

describe('concat', () => {
  test('collects all chunks and calls callback on flush', async () => {
    let collected: unknown[] = []
    const collector = concat((chunks) => {
      collected = chunks
    })

    const readable = Readable.from([{a: 1}, {b: 2}, {c: 3}])
    await pipeline(readable, collector)

    expect(collected).toEqual([{a: 1}, {b: 2}, {c: 3}])
  })

  test('calls callback with empty array when no data', async () => {
    let collected: unknown[] | null = null
    const collector = concat((chunks) => {
      collected = chunks
    })

    const readable = Readable.from([])
    await pipeline(readable, collector)

    expect(collected).toEqual([])
  })

  test('propagates errors thrown in callback', async () => {
    const failing = concat(() => {
      throw new Error('concat error')
    })

    const readable = Readable.from([{a: 1}])
    await expect(pipeline(readable, failing)).rejects.toThrow('concat error')
  })
})

describe('isWritableStream', () => {
  test('returns true for Writable stream', () => {
    const writable = new Writable({write(_chunk, _enc, cb) { cb() }})
    expect(isWritableStream(writable)).toBe(true)
  })

  test('returns true for PassThrough stream', () => {
    const pt = new PassThrough()
    expect(isWritableStream(pt)).toBe(true)
  })

  test('returns false for string', () => {
    expect(isWritableStream('/tmp/file.txt')).toBe(false)
  })

  test('returns false for null', () => {
    expect(isWritableStream(null)).toBe(false)
  })

  test('returns false for plain object', () => {
    expect(isWritableStream({pipe: 'not-a-function'})).toBe(false)
  })

  test('returns false for Readable stream', () => {
    const readable = new Readable({read() { this.push(null) }})
    expect(isWritableStream(readable)).toBe(false)
  })
})
