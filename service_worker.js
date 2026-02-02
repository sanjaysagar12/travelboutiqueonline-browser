// TBO Flight Search Interceptor - Service Worker

let state = {
    isListening: true,
    isScraping: false,
    capturedRequest: null,
    currentPage: 0,
    stopRequested: false,
    scrapedData: [] // Store parsed objects here
};

// --- Offscreen Management ---
async function setupOffscreenDocument(path) {
    // Check if offscreen document exists
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [path]
    });

    if (existingContexts.length > 0) {
        return;
    }

    // Create offscreen document
    if (chrome.offscreen) {
        await chrome.offscreen.createDocument({
            url: path,
            reasons: ['DOM_PARSER'],
            justification: 'Parse flight HTML results',
        });
    } else {
        console.warn("chrome.offscreen API not available (Requires MV3 & Chrome 109+)");
    }
}

// Ensure offscreen is ready when we start
setupOffscreenDocument('offscreen.html');

// --- Messaging ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_STATUS') {
        sendStatusForPopup(sendResponse);
        return true;
    }

    if (request.action === 'START_SCRAPE') {
        if (!state.capturedRequest) {
            sendResponse({ success: false, error: "No request captured yet." });
            return;
        }
        state.isScraping = true;
        state.stopRequested = false;
        state.scrapedData = []; // Clear previous run
        chrome.storage.local.set({ status: 'scraping', pagesDownloaded: 0, flightData: [] });

        startPaginationLoop();
        sendResponse({ success: true });
    } else if (request.action === 'STOP_SCRAPE') {
        state.isScraping = false;
        state.stopRequested = true;
        console.log('Stop requested.');
        sendResponse({ success: true });
    } else if (request.action === 'CLEAR_DATA') {
        chrome.storage.local.clear();
        state.capturedRequest = null;
        state.isScraping = false;
        state.isListening = true;
        state.currentPage = 0;
        state.scrapedData = [];
        chrome.storage.local.set({ status: 'idle', flightData: [] });
        sendResponse({ success: true });
    } else if (request.action === 'OPEN_DASHBOARD') {
        chrome.tabs.create({ url: 'dashboard.html' });
    }
});

function sendStatusForPopup(sendResponse) {
    chrome.storage.local.get(['status', 'pagesDownloaded', 'lastCaptureTime'], (result) => {
        sendResponse({
            status: result.status || 'idle',
            pagesDownloaded: result.pagesDownloaded || 0,
            lastCaptureTime: result.lastCaptureTime,
            capturedUrl: state.capturedRequest ? state.capturedRequest.url : null
        });
    });
}

// --- Request Interception ---
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (state.isScraping) return;

        if (details.url.includes('FlightReturnSearchAjax.aspx')) {
            console.log('Intercepted target request:', details.url);
            state.capturedRequest = {
                url: details.url,
                method: details.method,
            };

            chrome.storage.local.set({
                status: 'ready',
                lastCaptureTime: Date.now()
            });
        }
    },
    {
        urls: [
            "https://m.travelboutiqueonline.com/FlightReturnSearchAjax.aspx*",
            "https://m.travelboutiqueonline.com/*/FlightReturnSearchAjax.aspx*"
        ]
    }
);

// --- Loop ---
async function startPaginationLoop() {
    console.log('Starting pagination loop...');
    state.currentPage = 0;

    while (!state.stopRequested) {
        try {
            console.log(`Fetching page ${state.currentPage}...`);

            const success = await fetchAndParsePage(state.currentPage);

            if (!success) {
                console.log('Pagination stopped (no results or error).');
                break;
            }

            // Update UI state
            chrome.storage.local.set({
                pagesDownloaded: state.currentPage + 1,
                lastCaptureTime: Date.now(),
                flightData: state.scrapedData // Update storage incrementally
            });

            state.currentPage++;
            await new Promise(r => setTimeout(r, 2000));

        } catch (err) {
            console.error('Error in pagination loop:', err);
            break;
        }
    }

    state.isScraping = false;
    state.stopRequested = false;
    chrome.storage.local.set({ status: 'finished' });
    console.log('Scraping session finished.');

    // Open Dashboard automatically on finish?
    chrome.tabs.create({ url: 'dashboard.html' });
}

async function fetchAndParsePage(pageNumber) {
    if (!state.capturedRequest) return false;

    let fetchUrl;
    try {
        const urlObj = new URL(state.capturedRequest.url);
        urlObj.searchParams.set('pageNumber', pageNumber);
        fetchUrl = urlObj.toString();
    } catch (e) {
        console.error("Failed to parse URL:", e);
        return false;
    }

    try {
        const response = await fetch(fetchUrl, {
            method: state.capturedRequest.method,
        });

        if (!response.ok) {
            console.error("Fetch failed:", response.status);
            return false;
        }

        const html = await response.text();

        if (!html || html.length < 100) {
            return false;
        }

        // --- PARSE VIA OFFSCREEN ---
        // If chrome.offscreen is missing (e.g. older chrome), we fail gracefully or try regex? 
        // Assuming MV3 environment.
        const parsedData = await chrome.runtime.sendMessage({
            action: 'PARSE_HTML',
            htmlChunk: html
        });

        if (parsedData && parsedData.length > 0) {
            state.scrapedData.push(...parsedData);
            return true;
        } else {
            // If parsing return 0 flights, maybe it's an end page or just empty results
            // We can treat it as end of pagination if standard behavior
            return false;
        }

    } catch (err) {
        console.error("Fetch error:", err);
        return false;
    }
}
