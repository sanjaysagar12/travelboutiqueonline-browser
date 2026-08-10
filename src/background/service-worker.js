// TBO Flight Search Interceptor - Service Worker
//
// Flow: capture the live flights-api.tbo.in search request the page itself
// issues (cookies/tokenId/tokenMemberId/tokenAgencyId/agencyId/segments all
// come from that captured body - nothing here is hard-coded), then replay
// it page-by-page via pagination.js until the server reports no more pages.

import { API_CONFIG } from '../api/api-config.js';
import { runPaginatedSearch } from '../api/pagination.js';
import { AuthError, ApiStatusError, MalformedResponseError } from '../api/response-parser.js';
import { debugLog, debugError } from '../common/debug-log.js';

const DASHBOARD_URL = 'src/ui/dashboard/dashboard.html';

let state = {
  isScraping: false,
  capturedRequest: null, // { url, method, body }
  stopRequested: false
};

// --- declarativeNetRequest: force Origin/Referer to match the real site ---
// fetch() from a service worker cannot set these (forbidden headers) and
// would otherwise send the extension's own chrome-extension:// origin.
const ORIGIN_HEADER_RULE_ID = 1001;

async function ensureOriginHeaderRule() {
  if (!chrome.declarativeNetRequest) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ORIGIN_HEADER_RULE_ID],
      addRules: [{
        id: ORIGIN_HEADER_RULE_ID,
        priority: 1,
        condition: {
          urlFilter: API_CONFIG.MATCH_URL_FILTER,
          resourceTypes: ['xmlhttprequest']
        },
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: API_CONFIG.ORIGIN_HEADER_VALUE },
            { header: 'Referer', operation: 'set', value: API_CONFIG.REFERER_HEADER_VALUE }
          ]
        }
      }]
    });
  } catch (err) {
    debugError('Failed to install header rule', err);
  }
}

ensureOriginHeaderRule();

// --- Messaging ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_STATUS') {
    sendStatusForPopup(sendResponse);
    return true;
  }

  if (request.action === 'START_SCRAPE') {
    if (!state.capturedRequest) {
      sendResponse({ success: false, error: 'No request captured yet.' });
      return;
    }
    if (state.isScraping) {
      sendResponse({ success: false, error: 'Already scraping.' });
      return;
    }

    state.isScraping = true;
    state.stopRequested = false;
    chrome.storage.local.set({ status: 'scraping', pagesDownloaded: 0, flightData: [], lastError: null });

    startPaginationLoop();
    sendResponse({ success: true });
  } else if (request.action === 'STOP_SCRAPE') {
    state.stopRequested = true;
    debugLog('Stop requested', {});
    sendResponse({ success: true });
  } else if (request.action === 'CLEAR_DATA') {
    chrome.storage.local.clear();
    state.capturedRequest = null;
    state.isScraping = false;
    state.stopRequested = false;
    chrome.storage.local.set({ status: 'idle', flightData: [] });
    sendResponse({ success: true });
  } else if (request.action === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: DASHBOARD_URL });
  }
});

function sendStatusForPopup(sendResponse) {
  chrome.storage.local.get(['status', 'pagesDownloaded', 'lastCaptureTime', 'lastError'], (result) => {
    sendResponse({
      status: result.status || 'idle',
      pagesDownloaded: result.pagesDownloaded || 0,
      lastCaptureTime: result.lastCaptureTime,
      lastError: result.lastError || null,
      capturedUrl: state.capturedRequest ? state.capturedRequest.url : null
    });
  });
}

// --- Request Interception ---
// Keeps listening for the entire lifetime of the service worker - not just
// until the first capture. Every POST the page itself sends to the search
// endpoint (a brand-new search, a filter change, a sort change, ...)
// overwrites state.capturedRequest with that exact payload, so Start
// always replicates whatever the user last did on the real site: filters
// (filterCriteriaOB), sort (sortBy/sortOrder), cabin class, pax counts,
// and the tokenId/tokenMemberId/tokenAgencyId/agencyId for their session -
// none of it is invented here.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method !== 'POST') return;

    // Our own pagination replay (src/api/request-builder.js) hits this
    // same endpoint. Those requests aren't tied to a browser tab and are
    // initiated from the extension's own origin - ignore them so we never
    // re-capture (and loop on) our own traffic.
    if (details.tabId === -1) return;
    if (details.initiator && details.initiator.startsWith('chrome-extension://')) return;

    let bodyObj = null;
    try {
      const raw = details.requestBody && details.requestBody.raw;
      if (raw && raw[0] && raw[0].bytes) {
        const text = new TextDecoder('utf-8').decode(raw[0].bytes);
        bodyObj = JSON.parse(text);
      }
    } catch (err) {
      debugError('Failed to decode captured request body', err);
      return;
    }

    if (!bodyObj || typeof bodyObj !== 'object') return;

    state.capturedRequest = {
      url: details.url,
      method: details.method,
      body: bodyObj
    };

    // Don't clobber a status the popup is actively showing progress for;
    // still record the capture so the next Start uses this latest payload.
    if (state.isScraping) {
      chrome.storage.local.set({ lastCaptureTime: Date.now() });
    } else {
      chrome.storage.local.set({ status: 'ready', lastCaptureTime: Date.now() });
    }

    debugLog('Captured search request', {
      whileScraping: state.isScraping,
      hasTokenId: Boolean(bodyObj.tokenId),
      hasTokenMemberId: Boolean(bodyObj.tokenMemberId),
      hasTokenAgencyId: Boolean(bodyObj.tokenAgencyId),
      hasTraceId: Boolean(bodyObj.traceId),
      hasFilters: Boolean(bodyObj.filterCriteriaOB),
      sortBy: bodyObj.sortBy,
      segments: Array.isArray(bodyObj.segments) ? bodyObj.segments.length : 0
    });
  },
  { urls: API_CONFIG.MATCH_PATTERNS },
  ['requestBody']
);

// --- Pagination Loop ---
async function startPaginationLoop() {
  debugLog('Starting pagination loop', {});
  await ensureOriginHeaderRule();

  try {
    const { allFlights, flightInfo, pagesFetched } = await runPaginatedSearch(state.capturedRequest.body, {
      isStopRequested: () => state.stopRequested,
      onPage: async ({ pageNumber, allFlights, flightInfo }) => {
        await chrome.storage.local.set({
          pagesDownloaded: pageNumber,
          lastCaptureTime: Date.now(),
          flightData: allFlights,
          flightInfo: flightInfo || undefined
        });
      }
    });

    debugLog('Pagination loop finished', { pagesFetched, totalFlights: allFlights.length });
    await chrome.storage.local.set({ status: 'finished', flightData: allFlights, flightInfo, lastError: null });
    chrome.tabs.create({ url: DASHBOARD_URL });
  } catch (err) {
    const message = describeError(err);
    debugError('Pagination loop failed', err);
    await chrome.storage.local.set({ status: 'error', lastError: message });
  } finally {
    state.isScraping = false;
    state.stopRequested = false;
  }
}

function describeError(err) {
  if (err instanceof AuthError) {
    return `Session expired or not logged in: ${err.message}`;
  }
  if (err instanceof ApiStatusError) {
    return `Search failed: ${err.message}`;
  }
  if (err instanceof MalformedResponseError) {
    return `Unexpected response from TBO: ${err.message}`;
  }
  if (err && err.message) {
    return err.message;
  }
  return 'Unknown error during scraping.';
}
