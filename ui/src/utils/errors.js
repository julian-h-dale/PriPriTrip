/**
 * Extract a human-readable message from an API error.
 *
 * Handles both RTK Query errors (`err.data.detail`) and axios errors
 * (`err.response.data.detail`). FastAPI validation errors can put an
 * object/array in `detail`, which must never be rendered as a React child,
 * so anything non-string falls back to the provided message.
 */
export function getErrorMessage(err, fallback) {
  const detail = err?.data?.detail ?? err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  return fallback;
}
