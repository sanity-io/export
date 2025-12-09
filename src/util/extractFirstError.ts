interface AggregateErrorLike {
  name: string
  errors: Array<{message: string}>
}

function isAggregateError(err: unknown): err is AggregateErrorLike {
  if (typeof err !== 'object' || err === null) {
    return false
  }

  if (err instanceof AggregateError) {
    return true
  }

  const record = err as Record<string, unknown>
  return (
    record.name === 'AggregateError' &&
    Array.isArray(record.errors) &&
    record.errors.length > 0 &&
    typeof record.errors[0] === 'object' &&
    record.errors[0] !== null &&
    'message' in record.errors[0]
  )
}

export function extractFirstError(err: unknown): unknown {
  if (isAggregateError(err)) {
    return err.errors[0]
  }
  return err
}
