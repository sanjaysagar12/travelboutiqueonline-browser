// Isolated request construction for the flights-api search endpoint.
// The captured base body (tokenId/tokenMemberId/tokenAgencyId/agencyId/
// segments/pax counts/etc) comes verbatim from the user's own browser
// request - this module only ever adds/removes the pagination fields.

import { API_CONFIG } from './api-config.js';

// Stage 1 (page 1) must NOT contain traceId. Stage 2+ must contain both
// traceId and pageNumber, taken from the server's own response metadata.
export function buildPageRequestBody(baseBody, { pageNumber, traceId }) {
  const body = { ...baseBody };

  if (pageNumber && pageNumber > 1) {
    body.pageNumber = pageNumber;
  } else {
    delete body.pageNumber;
  }

  if (traceId) {
    body.traceId = traceId;
  } else {
    delete body.traceId;
  }

  return body;
}

export async function fetchSearchPage(body) {
  const response = await fetch(API_CONFIG.SEARCH_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  let json = null;
  try {
    json = await response.json();
  } catch (e) {
    json = null;
  }

  return { httpStatus: response.status, json };
}
