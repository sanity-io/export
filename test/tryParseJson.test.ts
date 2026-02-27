import {describe, expect, test} from 'vitest'

import {tryParseJson} from '../src/tryParseJson.js'

describe('tryParseJson', () => {
  test('parses valid JSON', () => {
    expect(tryParseJson('{"_id":"doc1","_type":"article"}')).toEqual({
      _id: 'doc1',
      _type: 'article',
    })
  })

  test('parses valid JSON with special characters', () => {
    expect(tryParseJson('{"title":"hello\\nworld"}')).toEqual({title: 'hello\nworld'})
  })

  test('throws on plain invalid JSON with original line in message', () => {
    expect(() => tryParseJson('{not valid json}')).toThrow('{not valid json}')
  })

  test('recovers error description from interrupted JSON line', () => {
    // Simulates a line where valid JSON was interrupted by an error object
    const interrupted = '{"_id":"doc1","_type":"art{"error":{"description":"Stream interrupted"}}'
    expect(() => tryParseJson(interrupted)).toThrow('Error streaming dataset: Stream interrupted')
  })

  test('throws original error when interrupted line has error without description', () => {
    const interrupted = '{"_id":"doc1","_type":"art{"error":{"other":"no desc"}}'
    expect(() => tryParseJson(interrupted)).toThrow()
  })

  test('includes error JSON in the thrown error message', () => {
    const errorJson = '{"error":{"description":"Connection lost"}}'
    const interrupted = `{"_id":"doc1","_type":"art${errorJson}`
    try {
      tryParseJson(interrupted)
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('Error streaming dataset: Connection lost')
      expect((err as Error).message).toContain(errorJson)
    }
  })
})
