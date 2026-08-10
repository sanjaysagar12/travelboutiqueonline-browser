// Centralized configuration for the TBO flights-api search flow.
// Keeping every endpoint/limit/pattern in one place makes it easy to react
// to future API changes without touching request/response/pagination logic.

export const API_CONFIG = {
  SEARCH_ENDPOINT: 'https://flights-api.tbo.in/api/v1/flights/search',
  MATCH_URL_FILTER: '||flights-api.tbo.in/api/v1/flights/search',
  MATCH_PATTERNS: ['https://flights-api.tbo.in/api/v1/flights/search*'],
  ORIGIN_HEADER_VALUE: 'https://flights.tbo.in',
  REFERER_HEADER_VALUE: 'https://flights.tbo.in/',
  // Hard safety cap so a misbehaving/looping API response can never spin
  // the extension forever, independent of the hasNextPage flag.
  MAX_PAGES: 50,
  PAGE_DELAY_MS: 1200
};
