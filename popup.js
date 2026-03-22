document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusText = document.getElementById('statusText');
  const pageCount = document.getElementById('pageCount');
  const lastTime = document.getElementById('lastTime');

  // Initial Poll
  pollStatus();

  // Periodic Poll
  setInterval(pollStatus, 1000);

  startBtn.addEventListener('click', async () => {
    // 1. Extract Route/Date
    await extractFlightInfo();
    
    // 2. Start Search
    chrome.runtime.sendMessage({ action: 'START_SCRAPE' }, (res) => {
      if (res && !res.success) {
        alert(res.error || "Cannot start.");
      }
      pollStatus();
    });
  });

  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'STOP_SCRAPE' }, pollStatus);
  });

  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'CLEAR_DATA' }, pollStatus);
  });

  const downloadHtmlBtn = document.getElementById('downloadHtmlBtn');
  downloadHtmlBtn.addEventListener('click', async () => {
    await downloadCurrentPageHtml();
  });

  async function downloadCurrentPageHtml() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML
      });

      if (results && results[0] && results[0].result) {
        const html = results[0].result;
        const blob = new Blob([html], { type: 'text/html' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result;
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `page_source_${timestamp}.html`;

          chrome.downloads.download({
            url: base64data,
            filename: filename,
            saveAs: true
          });
        };
        reader.readAsDataURL(blob);
      }
    } catch (err) {
      console.error("Failed to download HTML:", err);
      alert("Cannot capture HTML from this page.");
    }
  }

  async function extractFlightInfo() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const routeEl = document.querySelector('.modal_title .font-16.fw-600');
          const dateEl = document.querySelector('.modal_title .fs-12.fw-500');
          return {
            route: routeEl ? routeEl.textContent.trim() : null,
            date: dateEl ? dateEl.textContent.trim().replace(/^\|\s*/, '') : null
          };
        }
      });

      if (results && results[0] && results[0].result) {
        const info = results[0].result;
        chrome.storage.local.set({ flightInfo: info });
      }
    } catch (err) {
      console.error("Failed to extract info:", err);
    }
  }

  function pollStatus() {
    chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (state) => {
      if (chrome.runtime.lastError || !state) return;
      updateUI(state);
    });
  }

  function updateUI(state) {
    const status = state.status;
    const count = state.pagesDownloaded;
    const time = state.lastCaptureTime;

    statusText.textContent = getStatusLabel(status);
    pageCount.textContent = count;

    if (time) {
      const date = new Date(time);
      lastTime.textContent = date.toLocaleTimeString();
    } else {
      lastTime.textContent = '-';
    }

    // Styling
    statusText.className = 'status-indicator status-' + status.toLowerCase();

    // Button Logic
    // Idle: Start disabled (waiting for capture)
    // Ready: Start enabled (captured, ready to scrape)
    // Scraping: Start disabled, Stop enabled
    // Finished: Start enabled (to restart?), Stop disabled

    if (status === 'idle') {
      startBtn.disabled = true;
      startBtn.textContent = 'Wait for Request...';
      stopBtn.disabled = true;
    } else if (status === 'ready') {
      startBtn.disabled = false;
      startBtn.textContent = 'Start Scraping';
      stopBtn.disabled = true;
    } else if (status === 'scraping') {
      startBtn.disabled = true;
      startBtn.textContent = 'Scraping...';
      stopBtn.disabled = false;
    } else if (status === 'finished') {
      startBtn.disabled = false;
      startBtn.textContent = 'Restart Scraping';
      stopBtn.disabled = true;
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'idle': return 'Waiting for Traffic...';
      case 'ready': return 'Request Captured!';
      case 'scraping': return 'Scraping...';
      case 'finished': return 'Finished';
      default: return status;
    }
  }
});
