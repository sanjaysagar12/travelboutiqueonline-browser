# Architecture

The extension is organized into four layers so that a future API or UI
change touches as few files as possible. Nothing outside `src/api/` and
`src/parser/` knows anything about the shape of TBO's JSON.

```
src/
├── api/            request/response layer  — talks to flights-api.tbo.in
├── parser/         translation layer       — API JSON -> internal flight model
├── background/     orchestration layer     — capture, messaging, storage, glue
├── common/          cross-cutting          — redacted debug logging
└── ui/
    ├── popup/       control surface        — start/stop/clear/download
    └── dashboard/   presentation layer      — table, markup, export
```

## Layers

### `src/api/` — API layer

Everything that knows about the HTTP contract with
`flights-api.tbo.in/api/v1/flights/search` lives here. Nothing else in the
codebase constructs a request or reads a raw `fetch` response.

| File | Responsibility |
| --- | --- |
| `api-config.js` | Single source of truth for the endpoint URL, the `declarativeNetRequest` match filter, `Origin`/`Referer` header values, and safety limits (`MAX_PAGES`, `PAGE_DELAY_MS`). |
| `request-builder.js` | `buildPageRequestBody(baseBody, {pageNumber, traceId})` — clones the *captured* base request and adds/removes only the pagination fields. `fetchSearchPage(body)` — performs the POST with `credentials:'include'` and returns `{httpStatus, json}`. |
| `response-parser.js` | `parseSearchResponse(httpStatus, json)` validates the response and throws one of `AuthError` / `ApiStatusError` / `MalformedResponseError` on failure; otherwise returns `{traceId, result, pagination}`. |
| `pagination.js` | `runPaginatedSearch(baseBody, {onPage, isStopRequested})` — the orchestration loop. Seeds its starting `traceId`/`pageNumber` from `baseBody` itself: a brand-new search (no `traceId`) starts page 1 with none and extracts one from the response, while a filter/sort refinement of an already-open result set (`baseBody` already has a `traceId`) is replicated as-is from page 1. Either way it then walks page 2..N (`traceId`, `pageNumber`) → stop on `hasNextPage:false`, a stop request, or `MAX_PAGES`. Dedupes flights by `fareOption.resultIndex` across pages. |

**Why `pagination.js` lives in `api/` and not `background/`:** it only
depends on `request-builder.js`, `response-parser.js`, and
`parser/field-mapper.js` — no `chrome.*` APIs. That makes it directly
unit-testable with plain Node (see [Verifying changes](#verifying-changes)).

### `src/parser/` — Parser layer

`field-mapper.js` is the only file that knows both the API's JSON shape
*and* the dashboard's internal flight object shape. It exposes two pure
functions:

- `mapResultToFlights(result)` — flattens `result` (an array of itinerary
  groups), and for each itinerary combines its `journey` legs/segments and
  `fareOptions` into the flat object the dashboard already understands:
  `{ Airline, FlightNumber, DepartureTime, Origin, ArrivalTime,
  Destination, Duration, Stops, <FareTierName>: price, ... }`. Each
  returned flight also carries a `_id` (the fare option's `resultIndex`,
  or a synthesized fallback) used purely for cross-page de-duplication.
- `deriveFlightInfo(result)` — pulls the route/date shown in the dashboard
  header straight from the first itinerary's journey data (city names,
  airport codes, `deptDate`). This avoids depending on any page DOM
  structure, which is brittle and changes with every frontend redeploy.

Because this is pure data-in/data-out, it's the easiest layer to test —
see [Verifying changes](#verifying-changes).

### `src/background/` — Orchestration layer

`service-worker.js` is the only file with `chrome.*` side effects. It:

1. Installs a `declarativeNetRequest` session rule that force-sets
   `Origin`/`Referer` on outgoing requests to the search endpoint (a
   `fetch()` from a service worker cannot set these forbidden headers
   itself, and would otherwise send its `chrome-extension://` origin).
2. Listens via `chrome.webRequest.onBeforeRequest` (with the
   `requestBody` extra info) for **every** POST the site's own JS sends to
   the search endpoint, for as long as the service worker is alive - not
   just the first one. Each capture decodes the JSON body and overwrites
   the in-memory "captured request", so a filter change
   (`filterCriteriaOB`), a sort change (`sortBy`/`sortOrder`), or a brand
   new search all update what **Start** will replicate. This is the
   **only** source of `tokenId`, `tokenMemberId`, `tokenAgencyId`,
   `agencyId`, and search parameters — none of it is hard-coded or
   invented. Requests initiated by the extension's own pagination replay
   (`tabId === -1`, or a `chrome-extension://` initiator) are ignored so
   the listener never re-captures its own traffic.
3. Handles popup messages (`GET_STATUS`, `START_SCRAPE`, `STOP_SCRAPE`,
   `CLEAR_DATA`, `OPEN_DASHBOARD`).
4. Drives `pagination.js`'s `runPaginatedSearch`, writing progress
   (`pagesDownloaded`, `flightData`, `flightInfo`, `status`) to
   `chrome.storage.local` after every page so the popup and dashboard can
   read live progress.
5. Translates thrown errors (`AuthError`, `ApiStatusError`,
   `MalformedResponseError`, or anything else) into a human-readable
   `lastError` string and a `status: 'error'` for the popup to display —
   never a silent failure or an infinite retry loop.

### `src/common/` — Cross-cutting

`debug-log.js` provides `debugLog`/`debugError` helpers that redact known
sensitive keys (`tokenId`, `tokenAgencyId`, cookies, etc.) and truncate
`traceId`-like values before they ever reach `console.log`. Every log call
in `background/` and `api/` goes through this — no file constructs a log
line by hand.

### `src/ui/` — UI layer

- **`popup/`** — the toolbar control surface. `popup.js` only talks to the
  background layer via `chrome.runtime.sendMessage`; it has no knowledge
  of the API or flight data shape. `popup.css` is a self-contained
  stylesheet using the same design tokens (blue primary, card layout) as
  the dashboard, with an icon-button toolbar instead of stacked full-width
  buttons.
- **`dashboard/`** — reads `flightData`/`flightInfo`/`columnVisibility`
  from `chrome.storage.local` and renders the table. It has no knowledge
  of `flights-api.tbo.in` at all: any object with the fields
  `field-mapper.js` produces (base columns + arbitrary fare-tier keys)
  renders correctly, which is what let this layer go **completely
  unmodified** by the API migration.

## Data flow

```
flights.tbo.in (real browser request, with real cookies/token)
        │
        ▼  chrome.webRequest.onBeforeRequest (+ requestBody)
background/service-worker.js  ──captures──▶  { url, method, body }
        │
        ▼  body passed as-is
api/pagination.js
        │
        ├─▶ api/request-builder.js  → buildPageRequestBody() → fetchSearchPage()
        │                                   │
        │                                   ▼
        │                         flights-api.tbo.in/api/v1/flights/search
        │                                   │
        │◀──────────── {httpStatus, json} ──┘
        │
        ▼
api/response-parser.js → parseSearchResponse() → {traceId, result, pagination}
        │
        ├─▶ parser/field-mapper.js → mapResultToFlights() / deriveFlightInfo()
        │
        ▼  onPage callback, every page
chrome.storage.local  { flightData, flightInfo, pagesDownloaded, status }
        │
        ├─▶ ui/popup   (polls status every 1s)
        └─▶ ui/dashboard (reads once on open, renders table)
```

## Extending / adapting to API changes

If TBO changes the search API again:

- **Different response fields** (e.g. renamed `journey`/`fareOptions`) →
  edit `src/parser/field-mapper.js` only. The dashboard, popup, and
  pagination loop are unaffected as long as the mapper keeps returning the
  same base-column shape.
- **Different pagination contract** (e.g. cursor-based instead of
  `pageNumber`/`traceId`) → edit `src/api/request-builder.js` (what goes
  in the request) and `src/api/pagination.js`'s loop condition. Nothing
  else changes.
- **Different endpoint URL or required headers** → edit
  `src/api/api-config.js` (and the `declarativeNetRequest` rule in
  `service-worker.js` if the required `Origin`/`Referer` values change).
- **New failure mode to handle** → add a new error class in
  `src/api/response-parser.js` and a branch in
  `service-worker.js#describeError`.

## Verifying changes

`parser/field-mapper.js` and `api/pagination.js`'s pure logic can be
exercised outside the extension runtime with plain Node, using captured
API responses as fixtures:

```js
import { mapResultToFlights, deriveFlightInfo } from './src/parser/field-mapper.js';
const response = JSON.parse(fs.readFileSync('response_data/search1.json', 'utf-8'));
console.log(mapResultToFlights(response.result).length);
console.log(deriveFlightInfo(response.result));
```

For everything touching `chrome.*` (the background service worker, popup,
dashboard), load the extension unpacked (`chrome://extensions` → Developer
mode → Load unpacked) and inspect the service worker console for the
`[TBO Scraper]` debug lines described in the README.
