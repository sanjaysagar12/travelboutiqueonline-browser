# TBO Flight Search Interceptor

A Chrome (MV3) extension that captures the flight search request your
browser makes on **flights.tbo.in**, replays it page-by-page against the
`flights-api.tbo.in` search API using your existing logged-in session, and
renders every result in a sortable, markup-able dashboard.

It never asks you to log in, never stores credentials, and never invents a
session — it only reuses the cookies and search request your browser
already sent.

## Features

- Captures the live search request (cookies, token, agency/member ids,
  search params) directly from network traffic — nothing hard-coded.
- Keeps listening for the entire browsing session, not just the first
  request: every time you change a filter (airline, stops, ...) or sort
  order on the real site, the extension quietly re-captures that exact
  request, so **Start** always replicates whatever you last set up on the
  page — including `filterCriteriaOB`, `sortBy`/`sortOrder`, and an
  already-open `traceId` when you're refining an existing result set.
- Walks every result page automatically until the API reports
  `hasNextPage: false`, merging and de-duplicating flights as it goes.
- Renders results in a dashboard: per-fare-tier columns, global/per-column
  markup, column visibility toggles, CSV export, and "copy for email"
  (rich HTML table) export.
- Clean failure modes: expired session, HTTP errors, malformed responses,
  and missing pagination metadata are all surfaced in the popup instead of
  hanging or silently producing partial data.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this repository's root folder.

## Usage

1. Open [flights.tbo.in](https://flights.tbo.in) and log in as you
   normally would.
2. Run a flight search. The extension's popup status dot turns amber
   ("Request Captured") once it has seen the search request.
3. Optionally, adjust filters (airline, stops, ...) or sorting on the page
   itself — each change re-issues a search request, which the extension
   silently re-captures as the new "latest" request to replicate.
4. Click **Start**. The popup shows live progress (pages fetched, last
   update time); a dashboard tab opens automatically when scraping
   finishes.
5. In the dashboard: apply a global or per-fare-column markup, toggle
   which columns are visible, and export via **Download CSV** or
   **Copy for Email**.
6. Click **Clear** in the popup to reset captured state and start over
   with a fresh search.

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full breakdown of layers
and data flow. Short version:

```
manifest.json               Extension manifest (MV3)
assets/                     Static assets (icon, city-name lookup data)
src/
  api/                      Talks to flights-api.tbo.in (config, request
                             building, response validation, pagination)
  parser/                   Maps API JSON -> the dashboard's flight model
  background/               Service worker: capture + orchestration + storage
  ui/popup/                 Toolbar popup (start/stop/clear/download)
  ui/dashboard/             Results dashboard (table, markup, export)
  common/                   Cross-cutting helpers (redacted debug logging)
```

## Notes on the API

- The extension does not log in or manage sessions itself. It relies on
  `chrome.webRequest` to read the JSON body of the search request the
  site's own JavaScript sends, which already contains a valid
  `tokenId`/`tokenMemberId`/`tokenAgencyId`/`agencyId` for your session.
- The `webRequest` listener never stops: it keeps overwriting the "latest
  captured request" for as long as the service worker is alive, so a
  filter/sort change made after the popup was opened is still picked up.
  It ignores the extension's own replay requests (identified by
  `tabId === -1` / a `chrome-extension://` initiator) so it never captures
  its own traffic.
- Subsequent page requests are built by cloning that captured body and
  only ever changing `pageNumber`/`traceId`, matching what the real
  frontend does. If the captured request already carried a `traceId`
  (a filter/sort refinement of an already-open result set), that `traceId`
  is reused as-is instead of being stripped.
- If TBO changes its API shape again, only `src/api/response-parser.js`
  and `src/parser/field-mapper.js` should need updates — see
  [ARCHITECTURE.md](ARCHITECTURE.md#extending--adapting-to-api-changes).
