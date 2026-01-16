import {describe, expect, test} from 'vitest'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'

import {split} from '../src/util/streamHelpers.js'

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
