// Redacted debug logging. Never let raw cookies, tokens, or member/agency
// ids reach the console - only structural/diagnostic info is logged.

const SENSITIVE_KEYS = new Set([
  'tokenId', 'tokenMemberId', 'tokenAgencyId', 'agencyId',
  'cookie', 'cookies', 'authorization', 'password'
]);

export function redactMiddle(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (value.length <= 12) return '<redacted>';
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function sanitize(data) {
  if (!data || typeof data !== 'object') return data;
  const safe = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key)) {
      safe[key] = '<redacted>';
    } else if (key.toLowerCase().includes('traceid') && typeof value === 'string') {
      safe[key] = redactMiddle(value);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

export function debugLog(label, data) {
  console.log(`[TBO Scraper] ${label}`, sanitize(data));
}

export function debugError(label, err) {
  console.error(`[TBO Scraper] ${label}`, err && err.message ? err.message : err);
}
