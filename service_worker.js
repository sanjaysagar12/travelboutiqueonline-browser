// TBO Flight Search Interceptor - Service Worker

let state = {
    isListening: true, // Default to true to catch requests passively
    isScraping: false,
    capturedRequest: null, // { url, method, headers }
    currentPage: 0,
    stopRequested: false
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_STATUS') {
        // Popup polling
        sendStatusForPopup(sendResponse);
        return true; // Keep channel open
    }

    if (request.action === 'START_SCRAPE') {
        if (!state.capturedRequest) {
            sendResponse({ success: false, error: "No request captured yet." });
            return;
        }
        state.isScraping = true;
        state.stopRequested = false;
        chrome.storage.local.set({ status: 'scraping', pagesDownloaded: 0 });
        startPaginationLoop();
        sendResponse({ success: true });
    } else if (request.action === 'STOP_SCRAPE') {
        state.isScraping = false;
        state.stopRequested = true;
        chrome.storage.local.set({ status: 'ready' }); // Go back to ready if stopped?
        console.log('Stop requested.');
        sendResponse({ success: true });
    } else if (request.action === 'CLEAR_DATA') {
        chrome.storage.local.clear();
        state.capturedRequest = null;
        state.isScraping = false;
        state.isListening = true;
        state.currentPage = 0;
        chrome.storage.local.set({ status: 'idle' });
        sendResponse({ success: true });
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

// Intercept Network Requests
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        // If we are already scraping, don't mess with state.
        if (state.isScraping) return;

        // Check for target
        if (details.url.includes('FlightReturnSearchAjax.aspx')) {
            console.log('Intercepted target request:', details.url);

            // Store the request details
            state.capturedRequest = {
                url: details.url,
                method: details.method,
                // For GET requests, body is undefined. We rely on URL parameters.
            };

            // We don't auto-start. We just update status to 'ready'
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
    // removed ["requestBody"] since it might be GET and we don't strictly need it for GET
);

async function startPaginationLoop() {
    console.log('Starting pagination loop...');
    state.currentPage = 0; // Or start from 0 as requested

    while (!state.stopRequested) {
        try {
            console.log(`Fetching page ${state.currentPage}...`);

            const success = await fetchPage(state.currentPage);

            if (!success) {
                console.log('Pagination stopped (no results or error).');
                break;
            }

            // Update UI state
            chrome.storage.local.set({
                pagesDownloaded: state.currentPage + 1,
                lastCaptureTime: Date.now()
            });

            state.currentPage++;

            // Safety delay
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
}

async function fetchPage(pageNumber) {
    if (!state.capturedRequest) return false;

    let fetchUrl;

    try {
        // Modify URL parameters
        const urlObj = new URL(state.capturedRequest.url);
        urlObj.searchParams.set('pageNumber', pageNumber);
        fetchUrl = urlObj.toString();
    } catch (e) {
        console.error("Failed to parse URL:", e);
        return false;
    }

    // Perform Fetch
    try {
        const response = await fetch(fetchUrl, {
            method: state.capturedRequest.method, // Likely GET
            // No specific body for GET
            // Cookies are handled by browser session automatically for same-origin/extension host permissions
        });

        if (!response.ok) {
            console.error("Fetch failed:", response.status);
            return false;
        }

        const html = await response.text();

        // Check for empty results
        if (!html || html.length < 100) {
            console.log("Response too short, assuming end.");
            return false;
        }

        savePage(html, pageNumber, fetchUrl);
        return true;

    } catch (err) {
        console.error("Fetch error:", err);
        return false;
    }
}

function savePage(htmlContent, pageNum, url) {
    const updateTime = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `flight_page_${pageNum}_${updateTime}.html`;
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);

    chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: false
    });

    // Logging/Storage
    const storageKey = `page_${pageNum}`;
    const storageData = {
        pageNumber: pageNum,
        url: url,
        htmlResponse: htmlContent.substring(0, 500) + "...", // Truncate for storage to save space, assuming file download is primary
        timestamp: Date.now()
    };

    let items = {};
    items[storageKey] = storageData;
    chrome.storage.local.set(items);
}
