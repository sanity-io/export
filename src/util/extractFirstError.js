exports.extractFirstError = function extractFirstError(err) {
  if (
    // eslint-disable-next-line no-undef
    ((typeof AggregateError !== 'undefined' && err instanceof AggregateError) ||
      ('name' in err && err.name === 'AggregateError')) &&
    Array.isArray(err.errors) &&
    err.errors.length > 0 &&
    'message' in err.errors[0]
  ) {
    return err.errors[0]
  }

  return err
}
