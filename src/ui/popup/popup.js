document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const pageCount = document.getElementById('pageCount');
  const lastTime = document.getElementById('lastTime');
  const startLabel = startBtn.querySelector('.btn-label');

  // Initial Poll
  pollStatus();

  // Periodic Poll
  setInterval(pollStatus, 1000);

  startBtn.addEventListener('click', async () => {
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

    statusText.textContent = getStatusLabel(status, state.lastError);
    pageCount.textContent = count;

    if (time) {
      const date = new Date(time);
      lastTime.textContent = date.toLocaleTimeString();
    } else {
      lastTime.textContent = '-';
    }

    // Styling
    const statusClass = 'status-' + status.toLowerCase();
    statusDot.className = 'status-dot ' + statusClass;

    // Button Logic
    // Idle: Start disabled (waiting for capture)
    // Ready: Start enabled (captured, ready to scrape)
    // Scraping: Start disabled, Stop enabled
    // Finished/Error: Start enabled (to restart), Stop disabled

    if (status === 'idle') {
      startBtn.disabled = true;
      startLabel.textContent = 'Start';
      startBtn.title = 'Waiting for a search request to be captured';
      stopBtn.disabled = true;
    } else if (status === 'ready') {
      startBtn.disabled = false;
      startLabel.textContent = 'Start';
      startBtn.title = 'Start scraping';
      stopBtn.disabled = true;
    } else if (status === 'scraping') {
      startBtn.disabled = true;
      startLabel.textContent = 'Start';
      stopBtn.disabled = false;
    } else if (status === 'finished') {
      startBtn.disabled = false;
      startLabel.textContent = 'Restart';
      startBtn.title = 'Restart scraping';
      stopBtn.disabled = true;
    } else if (status === 'error') {
      startBtn.disabled = false;
      startLabel.textContent = 'Retry';
      startBtn.title = 'Retry scraping';
      stopBtn.disabled = true;
    }
  }

  function getStatusLabel(status, lastError) {
    switch (status) {
      case 'idle': return 'Waiting for Traffic...';
      case 'ready': return 'Request Captured!';
      case 'scraping': return 'Scraping...';
      case 'finished': return 'Finished';
      case 'error': return lastError ? `Error: ${lastError}` : 'Error';
      default: return status;
    }
  }
});
