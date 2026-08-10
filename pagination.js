// Isolated pagination logic: drives page 1..N requests using only the
// server's own pagination metadata (currentPage/hasNextPage), merges and
// dedupes flights across pages, and stops on hasNextPage === false or on
// the hard MAX_PAGES safety cap.

import { API_CONFIG } from './api-config.js';
import { buildPageRequestBody, fetchSearchPage } from './request-builder.js';
import { parseSearchResponse } from './response-parser.js';
import { mapResultToFlights, deriveFlightInfo } from './field-mapper.js';
import { debugLog } from './debug-log.js';

// onPage(ctx) is called after each successful page with:
//   { pageNumber, newFlights, allFlights, flightInfo, pagination }
// isStopRequested() lets the caller cooperatively cancel mid-loop.
export async function runPaginatedSearch(baseBody, { onPage, isStopRequested }) {
  const allFlights = [];
  const seenIds = new Set();

  let traceId = null;
  let requestedPageNumber = 1;
  let flightInfo = null;
  let pagesFetched = 0;

  while (pagesFetched < API_CONFIG.MAX_PAGES) {
    if (isStopRequested && isStopRequested()) {
      debugLog('Pagination stopped by user request', { pageNumber: requestedPageNumber });
      break;
    }

    const body = buildPageRequestBody(baseBody, { pageNumber: requestedPageNumber, traceId });

    debugLog('Sending search request', {
      pageNumber: requestedPageNumber,
      hasTraceId: Boolean(traceId)
    });

    const { httpStatus, json } = await fetchSearchPage(body);
    const parsed = parseSearchResponse(httpStatus, json);
    pagesFetched++;

    if (!traceId) {
      traceId = parsed.traceId;
    }

    if (!flightInfo) {
      flightInfo = deriveFlightInfo(parsed.result);
    }

    const newFlights = [];
    for (const flight of mapResultToFlights(parsed.result)) {
      const { _id, ...rest } = flight;
      if (seenIds.has(_id)) continue;
      seenIds.add(_id);
      newFlights.push(rest);
      allFlights.push(rest);
    }

    debugLog('Received search response', {
      httpStatus,
      status: json && json.status,
      currentPage: parsed.pagination && parsed.pagination.currentPage,
      totalPages: parsed.pagination && parsed.pagination.totalPages,
      hasNextPage: parsed.pagination && parsed.pagination.hasNextPage,
      newFlights: newFlights.length,
      totalFlights: allFlights.length
    });

    if (onPage) {
      await onPage({
        pageNumber: parsed.pagination ? parsed.pagination.currentPage : requestedPageNumber,
        newFlights,
        allFlights,
        flightInfo,
        pagination: parsed.pagination
      });
    }

    if (!parsed.pagination || !parsed.pagination.hasNextPage) {
      break;
    }

    if (!traceId) {
      // Server said there's more, but never gave us a trace id to
      // continue with - stop rather than risk repeating page 1 forever.
      debugLog('Missing traceId, cannot continue pagination', {});
      break;
    }

    requestedPageNumber = (parsed.pagination.currentPage || requestedPageNumber) + 1;

    await new Promise(resolve => setTimeout(resolve, API_CONFIG.PAGE_DELAY_MS));
  }

  return { allFlights, flightInfo, pagesFetched };
}
