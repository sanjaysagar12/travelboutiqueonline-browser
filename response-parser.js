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

// Throws a typed error for any known failure mode; otherwise returns the
// normalized pieces the caller (pagination.js) needs.
export function parseSearchResponse(httpStatus, json) {
  if (httpStatus === 401 || httpStatus === 403) {
    throw new AuthError(`Authentication failed (HTTP ${httpStatus}). The browser session may be expired or logged out.`);
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new Error(`Unexpected HTTP status ${httpStatus} from search API.`);
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
