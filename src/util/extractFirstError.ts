interface AggregateErrorLike {
  name: string
  errors: Array<{message: string}>
}

/**
 * How many levels of wrapping to unwrap before giving up. Guards against an error
 * whose `cause` chain is circular.
 */
const MAX_UNWRAP_DEPTH = 10

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
  let current = err

  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    if (isAggregateError(current)) {
      current = current.errors[0]
      continue
    }

    // `fetch()` reports every transport-level failure as an opaque `TypeError: fetch
    // failed`, keeping the actual reason (eg `ECONNREFUSED`) on `cause`. Without
    // unwrapping it, the error we report to the user says nothing about what went wrong.
    if (current instanceof Error && current.cause !== undefined && current.cause !== null) {
      current = current.cause
      continue
    }

    break
  }

  return current
}
