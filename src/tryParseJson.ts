interface SafeJsonParserOptions {
  errorLabel: string
}

interface ParsedErrorLine {
  error?: {
    description?: string
  }
}

function createSafeJsonParser({errorLabel}: SafeJsonParserOptions) {
  return function safeJsonParser(line: string): unknown {
    try {
      return JSON.parse(line) as unknown
    } catch (err) {
      // Catch half-done lines with an error at the end
      const errorPosition = line.lastIndexOf('{"error":')
      if (errorPosition === -1) {
        if (err instanceof Error) {
          err.message = `${err.message} (${line})`
        }
        throw err
      }

      const errorJson = line.slice(errorPosition)
      const errorLine = JSON.parse(errorJson) as ParsedErrorLine
      const error = errorLine.error
      if (error && error.description) {
        throw new Error(`${errorLabel}: ${error.description}\n\n${errorJson}\n`, {cause: err})
      }

      throw err
    }
  }
}

/**
 * Safe JSON parser that is able to handle lines interrupted by an error object.
 *
 * This may occur when streaming NDJSON from the Export HTTP API.
 *
 * @internal
 * @see {@link https://github.com/sanity-io/sanity/pull/1787 | Initial pull request}
 */
export const tryParseJson = createSafeJsonParser({
  errorLabel: 'Error streaming dataset',
})
