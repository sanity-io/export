export async function tryThrowFriendlyError(err) {
  if (!isRecord(err)) {
    return null
  }

  if (!('response' in err) || !isRecord(err.response)) {
    return null
  }

  if (
    !('body' in err.response) ||
    !('pipe' in err.response.body) ||
    !('headers' in err.response) ||
    !isRecord(err.response.headers)
  ) {
    return null
  }

  if (
    typeof err.response.headers['content-type'] !== 'string' ||
    !err.response.headers['content-type'].includes('application/json')
  ) {
    return null
  }

  const body = await readBodyJson(err.response.body)

  if (!isRecord(body)) {
    return null
  }

  // Look for Sanity API(ish) standard error shape
  const status =
    typeof err.response.statusCode === 'number' ? `HTTP ${err.response.statusCode}` : undefined
  const error = typeof body.error === 'string' ? body.error : undefined
  const message = typeof body.message === 'string' ? body.message : undefined
  if (!error && !message) {
    return null
  }

  throw new Error(['Export', status, error, message].filter(Boolean).join(': '))
}

function isRecord(thing) {
  return typeof thing === 'object' && thing !== null && !Array.isArray(thing)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

async function readBodyJson(req) {
  return JSON.parse((await readBody(req)).toString('utf8'))
}
