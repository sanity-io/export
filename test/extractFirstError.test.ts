import {describe, expect, test} from 'vitest'

import {extractFirstError} from '../src/util/extractFirstError.js'

describe('extractFirstError', () => {
  test('unwraps native AggregateError to first error', () => {
    const first = new Error('first error')
    const second = new Error('second error')
    const aggregate = new AggregateError([first, second], 'multiple errors')
    expect(extractFirstError(aggregate)).toBe(first)
  })

  test('unwraps duck-typed AggregateError', () => {
    const first = {message: 'duck-typed error'}
    const duckTyped = {
      name: 'AggregateError',
      errors: [first, {message: 'another'}],
    }
    expect(extractFirstError(duckTyped)).toBe(first)
  })

  test('returns regular Error unchanged', () => {
    const err = new Error('simple error')
    expect(extractFirstError(err)).toBe(err)
  })

  test('returns non-error values unchanged', () => {
    expect(extractFirstError('string error')).toBe('string error')
    expect(extractFirstError(42)).toBe(42)
    expect(extractFirstError(null)).toBe(null)
    expect(extractFirstError(undefined)).toBe(undefined)
  })

  test('does not unwrap object with name AggregateError but empty errors', () => {
    const notAggregate = {name: 'AggregateError', errors: []}
    expect(extractFirstError(notAggregate)).toBe(notAggregate)
  })

  test('does not unwrap object with name AggregateError but non-object errors', () => {
    const notAggregate = {name: 'AggregateError', errors: ['string']}
    expect(extractFirstError(notAggregate)).toBe(notAggregate)
  })
})
