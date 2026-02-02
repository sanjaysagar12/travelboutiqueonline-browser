// Dashboard Logic

let allData = [];
let fareColumns = [];
const baseColumns = ["Airline", "FlightNumber", "DepartureTime", "Origin", "ArrivalTime", "Destination", "Duration", "Stops"];

document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // Attach Event Listeners
    document.getElementById('btnApplyGlobal').addEventListener('click', applyGlobalMarkup);
    document.getElementById('btnApplyCol').addEventListener('click', applyColMarkup);
    document.getElementById('btnCopyEmail').addEventListener('click', copyForEmail);
    document.getElementById('btnDownloadCsv').addEventListener('click', exportCSV);
});

function loadData() {
    chrome.storage.local.get(['flightData'], (result) => {
        if (result.flightData && Array.isArray(result.flightData)) {
            allData = result.flightData;
            identifyColumns();
            renderTable();
            populateColSelect();
        } else {
            console.warn("No flight data found in storage.");
        }
    });
}

function identifyColumns() {
    const fares = new Set();
    allData.forEach(flight => {
        Object.keys(flight).forEach(key => {
            if (!baseColumns.includes(key)) {
                fares.add(key);
            }
        });
    });
    fareColumns = Array.from(fares).sort();
}

function renderTable() {
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');

    // Headers
    thead.innerHTML = '';
    [...baseColumns, ...fareColumns].forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        thead.appendChild(th);
    });

    // Rows
    tbody.innerHTML = '';
    allData.forEach(flight => {
        const tr = document.createElement('tr');
        [...baseColumns, ...fareColumns].forEach(col => {
            const td = document.createElement('td');
            const val = flight[col];

            if (fareColumns.includes(col)) {
                // Formatting for price columns
                if (val && !isNaN(parseFloat(val))) {
                    td.textContent = parseFloat(val).toFixed(2);
                    td.className = 'price-val';
                } else {
                    td.textContent = '-';
                    td.className = 'empty-price';
                }
            } else {
                td.textContent = val !== undefined ? val : '';
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function populateColSelect() {
    const sel = document.getElementById('colSelect');
    sel.innerHTML = '<option value="">Select Column</option>';
    fareColumns.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        sel.appendChild(opt);
    });
}

// --- Markup Logic ---

// Note: markup adds to string price, so we need to be careful with formatting
function addMarkupToPrice(originalStr, markupAmount) {
    if (!originalStr) return "";
    let clean = originalStr.toString().replace(/[^\d.]/g, '');
    let val = parseFloat(clean);
    if (isNaN(val) || val === 0) return "";

    return (val + markupAmount).toFixed(2);
}

function applyGlobalMarkup() {
    const amount = parseFloat(document.getElementById('globalMarkup').value);
    if (isNaN(amount)) return alert("Invalid markup amount");

    allData.forEach(flight => {
        fareColumns.forEach(col => {
            // Apply only if exists
            flight[col] = addMarkupToPrice(flight[col], amount);
        });
    });
    renderTable();
}

function applyColMarkup() {
    const col = document.getElementById('colSelect').value;
    const amount = parseFloat(document.getElementById('colMarkup').value);

    if (!col) return alert("Select a column");
    if (isNaN(amount)) return alert("Invalid markup amount");

    allData.forEach(flight => {
        flight[col] = addMarkupToPrice(flight[col], amount);
    });
    renderTable();
}

// --- Export ---
function exportCSV() {
    if (allData.length === 0) return alert("No data");

    const headers = [...baseColumns, ...fareColumns];
    let csvContent = headers.join(",") + "\n";

    allData.forEach(row => {
        const rowData = headers.map(header => {
            let val = row[header] || "";
            // Excel CSV escaping
            if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        });
        csvContent += rowData.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const now = new Date().toISOString().replace(/[:.]/g, '-');

    chrome.downloads.download({
        url: url,
        filename: `flight_data_export_${now}.csv`,
        saveAs: true
    });
}

// --- Copy for Email ---
function copyForEmail() {
    if (allData.length === 0) return alert("No data to copy");

    const headers = [...baseColumns, ...fareColumns];

    // Create HTML string with inline styles for email compatibility
    let html = `
        <table border="1" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 12px; border: 1px solid #ddd;">
            <thead style="background-color: #f2f2f2;">
                <tr>`;

    headers.forEach(h => {
        html += `<th style="padding: 8px; border: 1px solid #ddd; text-align: left;">${h}</th>`;
    });

    html += `</tr></thead><tbody>`;

    allData.forEach(row => {
        html += `<tr>`;
        headers.forEach(h => {
            let val = row[h];
            if (fareColumns.includes(h) && val && !isNaN(parseFloat(val))) {
                // Determine if this cell has been marked up slightly differently? No, just copy values
                // Align numbers to right maybe?
                html += `<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${parseFloat(val).toFixed(2)}</td>`;
            } else {
                html += `<td style="padding: 8px; border: 1px solid #ddd;">${val !== undefined ? val : ''}</td>`;
            }
        });
        html += `</tr>`;
    });

    html += `</tbody></table>`;

    // Copy HTML to clipboard
    const blobHtml = new Blob([html], { type: 'text/html' });
    const blobText = new Blob([html], { type: 'text/plain' }); // Fallback

    const item = new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText
    });

    navigator.clipboard.write([item]).then(() => {
        alert("Table copied to clipboard! You can paste it into an email.");
    }).catch(err => {
        console.error(err);
        alert("Failed to copy. See console.");
    });
}
