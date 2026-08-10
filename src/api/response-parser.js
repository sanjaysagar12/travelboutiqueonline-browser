// Isolated response parsing/validation for the flights-api search endpoint.
// Keeping this separate from request construction and pagination means a
// future response-shape change only needs edits here.

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ApiStatusError extends Error {
  constructor(message, apiStatus) {
    super(message);
    this.name = 'ApiStatusError';
    this.apiStatus = apiStatus;
  }
}

export class MalformedResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MalformedResponseError';
  }
}

// Best-effort extraction of a human-readable message from an error
// response so failures aren't just "HTTP 500" with no further clue. Safe
// to surface: this is the server's own error text, never anything we sent
// (tokens/cookies), so no redaction is needed here.
function extractErrorDetail(json, rawText) {
  if (json && typeof json === 'object') {
    const candidate = json.message || json.error || json.title || json.errorMessage
      || (Array.isArray(json.errors) ? json.errors.join('; ') : json.errors);
    if (candidate) return String(candidate).slice(0, 300);
  }
  if (typeof rawText === 'string' && rawText.trim()) {
    return rawText.trim().slice(0, 300);
  }
  return null;
}

// Throws a typed error for any known failure mode; otherwise returns the
// normalized pieces the caller (pagination.js) needs.
export function parseSearchResponse(httpStatus, json, rawText) {
  if (httpStatus === 401 || httpStatus === 403) {
    throw new AuthError(`Authentication failed (HTTP ${httpStatus}). The browser session may be expired or logged out.`);
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    const detail = extractErrorDetail(json, rawText);
    throw new Error(`Unexpected HTTP status ${httpStatus} from search API${detail ? ` - ${detail}` : ''}.`);
  }
  if (!json || typeof json !== 'object') {
    throw new MalformedResponseError('Response body was not a JSON object.');
  }
  if (json.status !== 'SUCCESS') {
    throw new ApiStatusError(`API returned non-success status: ${json.status || 'UNKNOWN'}`, json.status);
  }
  if (!Array.isArray(json.result)) {
    throw new MalformedResponseError('Response is missing the expected "result" array.');
  }

  const paginationInfo = Array.isArray(json.pagination) ? json.pagination[0] : json.pagination;

  return {
    traceId: typeof json.traceId === 'string' ? json.traceId : null,
    result: json.result,
    pagination: paginationInfo || null
  };
}
