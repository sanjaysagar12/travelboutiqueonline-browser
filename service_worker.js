// TBO Flight Search Interceptor - Service Worker
//
// Flow: capture the live flights-api.tbo.in search request the page itself
// issues (cookies/tokenId/tokenMemberId/tokenAgencyId/agencyId/segments all
// come from that captured body - nothing here is hard-coded), then replay
// it page-by-page via pagination.js until the server reports no more pages.

import { API_CONFIG } from './api-config.js';
import { runPaginatedSearch } from './pagination.js';
import { AuthError, ApiStatusError, MalformedResponseError } from './response-parser.js';
import { debugLog, debugError } from './debug-log.js';

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
    chrome.tabs.create({ url: 'dashboard.html' });
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
// Reads the JSON body of the search request the page's own JS sends. This
// is the only source of tokenId/tokenMemberId/tokenAgencyId/agencyId and
// the user's search parameters - none of it is invented here.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (state.isScraping) return;
    if (details.method !== 'POST') return;

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

    chrome.storage.local.set({ status: 'ready', lastCaptureTime: Date.now() });

    debugLog('Captured search request', {
      hasTokenId: Boolean(bodyObj.tokenId),
      hasTokenMemberId: Boolean(bodyObj.tokenMemberId),
      hasTokenAgencyId: Boolean(bodyObj.tokenAgencyId),
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
    chrome.tabs.create({ url: 'dashboard.html' });
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
