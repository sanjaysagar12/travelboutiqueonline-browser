// Dashboard Logic

let allData = [];
let fareColumns = [];
const baseColumns = ["Airline", "Flight #", "Departure", "From", "Arrival", "To", "Duration", "Stops"];
let currentTheme = 'blue'; // 'blue' or 'green'
let cityMapping = {};
let columnVisibility = {};

document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // Attach Event Listeners
    document.getElementById('btnApplyGlobal').addEventListener('click', applyGlobalMarkup);
    document.getElementById('btnApplyCol').addEventListener('click', applyColMarkup);
    document.getElementById('btnCopyEmail').addEventListener('click', copyForEmail);
    document.getElementById('btnDownloadCsv').addEventListener('click', exportCSV);
    document.getElementById('btnToggleTheme').addEventListener('click', toggleTheme);
    document.getElementById('btnToggleDisplay').addEventListener('click', toggleDisplayDropdown);
    document.getElementById('btnSaveDisplay').addEventListener('click', saveColumnVisibility);

    // Close dropdown on outside click
    window.addEventListener('click', (e) => {
        const dropdown = document.getElementById('displayDropdown');
        const btn = document.getElementById('btnToggleDisplay');
        if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
});

function toggleTheme() {
    currentTheme = (currentTheme === 'blue') ? 'green' : 'blue';
    const body = document.body;
    const label = document.getElementById('currentThemeLabel');

    if (currentTheme === 'green') {
        body.classList.add('theme-green');
        label.textContent = 'Green';
    } else {
        body.classList.remove('theme-green');
        label.textContent = 'Blue';
    }
}

function toggleDisplayDropdown() {
    const dropdown = document.getElementById('displayDropdown');
    dropdown.classList.toggle('hidden');
    if (!dropdown.classList.contains('hidden')) {
        populateDisplayDropdown();
    }
}

function populateDisplayDropdown() {
    const container = document.getElementById('columnChecklist');
    container.innerHTML = '';

    const allHeaders = baseColumns;
    allHeaders.forEach(col => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = `vis-${col}`;
        cb.checked = !!columnVisibility[col];

        const label = document.createElement('label');
        label.htmlFor = `vis-${col}`;
        label.textContent = col;
        label.style.marginLeft = '8px';
        label.style.cursor = 'pointer';

        item.appendChild(cb);
        item.appendChild(label);
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.padding = '8px 12px';

        item.addEventListener('click', (e) => {
            if (e.target !== cb) {
                cb.checked = !cb.checked;
            }
        });

        container.appendChild(item);
    });
}

function saveColumnVisibility() {
    const allHeaders = baseColumns;
    allHeaders.forEach(col => {
        const cb = document.getElementById(`vis-${col}`);
        if (cb) {
            columnVisibility[col] = cb.checked;
        }
    });

    chrome.storage.local.set({ columnVisibility }, () => {
        document.getElementById('displayDropdown').classList.add('hidden');
        renderTable();
    });
}

async function loadCityMapping() {
    try {
        const response = await fetch('cities.csv');
        const text = await response.text();
        const lines = text.split('\n');
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Simple split as the CSV doesn't appear to have quoted commas
            const cols = line.split(',');
            if (cols.length >= 3) {
                const city = cols[1].trim();
                const code = cols[2].trim().toUpperCase();
                cityMapping[code] = city;
            }
        }
    } catch (err) {
        console.warn("Could not load cities.csv:", err);
    }
}

function loadData() {
    loadCityMapping().then(() => {
        chrome.storage.local.get(['flightData', 'columnVisibility', 'flightInfo'], (result) => {
            if (result.columnVisibility) {
                columnVisibility = result.columnVisibility;
            }
            if (result.flightData && Array.isArray(result.flightData)) {
                // Normalize Data
                allData = result.flightData.map(flight => {
                    // Rename FlightNumber -> Flight #
                    if (flight.FlightNumber) {
                        flight['Flight #'] = flight.FlightNumber.replace(/-/g, ' ');
                        delete flight.FlightNumber;
                    }
                    // Rename DepartureTime -> Departure
                    if (flight.DepartureTime) {
                        flight.Departure = flight.DepartureTime;
                        delete flight.DepartureTime;
                    }
                    // Rename ArrivalTime -> Arrival
                    if (flight.ArrivalTime) {
                        flight.Arrival = flight.ArrivalTime;
                        delete flight.ArrivalTime;
                    }
                    // Stops
                    if (flight.Stops === '0 Stop') {
                        flight.Stops = 'Non Stop';
                    }
                    // Duration
                    if (flight.Duration) {
                        flight.Duration = flight.Duration.replace(/h/g, 'H').replace(/m/g, 'M');
                    }
                    // Origin -> From, Destination -> To
                    if (flight.Origin) {
                        flight.From = flight.Origin;
                        delete flight.Origin;
                    }
                    if (flight.Destination) {
                        flight.To = flight.Destination;
                        delete flight.Destination;
                    }
                    return flight;
                });

                // Update Header with Route Info
                if (result.flightInfo) {
                    document.getElementById('pageTitle').textContent = result.flightInfo.route || "Flight Results";
                    document.getElementById('routeSubtitle').textContent = result.flightInfo.date ? `✈ ${result.flightInfo.date} | ${allData.length} Flights Found` : `${allData.length} Flights Found`;
                } else if (allData.length > 0) {
                    const first = allData[0];
                    const fromCode = (first.From || first.Origin || '').toUpperCase();
                    const toCode = (first.To || first.Destination || '').toUpperCase();

                    const fromName = cityMapping[fromCode] || fromCode || 'From';
                    const toName = cityMapping[toCode] || toCode || 'To';

                    document.getElementById('pageTitle').textContent = "Flight Results";
                    document.getElementById('routeSubtitle').textContent = `${fromName} ➝ ${toName} | ${allData.length} Flights Found`;
                }

                identifyColumns();
                renderTable();
                populateColSelect();
            } else {
                console.warn("No flight data found in storage.");
            }
        });
    });
}

function identifyColumns() {
    const allKeys = new Set();
    allData.forEach(flight => {
        Object.keys(flight).forEach(key => {
            if (!baseColumns.includes(key)) {
                allKeys.add(key);
            }
        });
    });

    // Filter out columns that are completely empty (all values are missing/0)
    fareColumns = Array.from(allKeys).filter(col => {
        return allData.some(flight => {
            const val = flight[col];
            // Keep column if at least one row has a valid number > 0
            return val && !isNaN(parseFloat(val)) && parseFloat(val) > 0;
        });
    }).sort();

    // If only one fare type exists, rename it to "Fare"
    if (fareColumns.length === 1) {
        const oldName = fareColumns[0];
        const newName = "Fare";

        allData.forEach(flight => {
            if (flight.hasOwnProperty(oldName)) {
                flight[newName] = flight[oldName];
                delete flight[oldName];
            }
        });
        fareColumns = [newName];
    } else if (fareColumns.length > 1) {
        // If multiple fare types, create a consolidated "Fare" column
        syncUnifiedFare();
    }

    // Initialize/Update Visibility
    [...baseColumns, ...fareColumns].forEach(col => {
        if (columnVisibility[col] === undefined) {
            columnVisibility[col] = true; // All columns checked by default
        }
    });
}

function syncUnifiedFare() {
    // Only sync if "Fare" is a consolidated column (i.e., there are other fare columns)
    const hasOtherFares = fareColumns.some(col => col !== "Fare");
    if (!hasOtherFares) return;

    allData.forEach(flight => {
        // Find populated source fare columns (excluding the "Fare" column itself)
        const sourceFares = fareColumns.filter(col => col !== "Fare" && flight[col] && !isNaN(parseFloat(flight[col])) && parseFloat(flight[col]) > 0);

        if (sourceFares.length > 0) {
            // Display the value from the first available fare type
            flight["Fare"] = flight[sourceFares[0]];
        } else {
            flight["Fare"] = "";
        }
    });

    if (!fareColumns.includes("Fare")) {
        // Add "Fare" at the beginning of the fare columns
        fareColumns.unshift("Fare");
    }
}

function renderTable() {
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');

    const allHeaders = [...baseColumns, ...fareColumns];

    // Headers
    thead.innerHTML = '';
    allHeaders.forEach(col => {
        if (!columnVisibility[col]) return;

        const th = document.createElement('th');
        th.textContent = col;
        thead.appendChild(th);
    });

    // Rows
    tbody.innerHTML = '';
    allData.forEach(flight => {
        const tr = document.createElement('tr');
        allHeaders.forEach(col => {
            // Only render cells for checked columns
            if (!columnVisibility[col]) return;

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
    const controlGroup = document.getElementById('colMarkupControl');

    // Hide Column Markup if only 1 fare column (e.g. "Fare")
    if (fareColumns.length <= 1) {
        if (controlGroup) controlGroup.style.display = 'none';
        return;
    } else {
        if (controlGroup) controlGroup.style.display = 'flex';
    }

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
            // Apply only if exists and it's a source column
            if (col !== "Fare") {
                flight[col] = addMarkupToPrice(flight[col], amount);
            }
        });
    });
    syncUnifiedFare();
    renderTable();
}

function applyColMarkup() {
    const col = document.getElementById('colSelect').value;
    const amount = parseFloat(document.getElementById('colMarkup').value);

    if (!col) return alert("Select a column");
    if (isNaN(amount)) return alert("Invalid markup amount");

    allData.forEach(flight => {
        if (col === "Fare" && fareColumns.length > 1) {
            // Apply to all underlying fare columns if user selects the unified "Fare"
            fareColumns.forEach(c => {
                if (c !== "Fare") {
                    flight[c] = addMarkupToPrice(flight[c], amount);
                }
            });
        } else {
            flight[col] = addMarkupToPrice(flight[col], amount);
        }
    });

    syncUnifiedFare();
    renderTable();
}

// --- Export ---
function exportCSV() {
    if (allData.length === 0) return alert("No data");

    // Filter headers based on user selection
    const headers = [...baseColumns, ...fareColumns].filter(h => {
        if (!columnVisibility[h]) return false;
        // Fare consolidation logic
        if (fareColumns.includes("Fare") && fareColumns.length > 1) {
            return h === "Fare" || !fareColumns.includes(h);
        }
        return true;
    });
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
// --- Copy for Email ---
function copyForEmail() {
    if (allData.length === 0) return alert("No data to copy");

    chrome.storage.local.get(['flightInfo'], (result) => {
        const info = result.flightInfo || {};
        const route = info.route || "Flight Results";
        const date = info.date || "";

        // Filter headers based on user selection
        const headers = [...baseColumns, ...fareColumns].filter(h => {
            if (!columnVisibility[h]) return false;
            // Fare consolidation logic
            if (fareColumns.includes("Fare") && fareColumns.length > 1) {
                return h === "Fare" || !fareColumns.includes(h);
            }
            return true;
        });

        // Theme colors for email
        const themeColors = {
            blue: { headerBg: '#eff6ff', headerText: '#1d4ed8', border: '#bfdbfe' },
            green: { headerBg: '#ecfdf5', headerText: '#047857', border: '#bbf7d0' }
        };
        const colors = themeColors[currentTheme];

        // Header Section
        let html = `
            <div style="margin-bottom: 15px; font-family: Arial, sans-serif;">
                <h2 style="margin: 0; color: ${colors.headerText}; font-size: 18px;">${route}</h2>
                ${date ? `<p style="margin: 4px 0 0; color: #6b7280; font-size: 13px;">✈ ${date}</p>` : ''}
            </div>
            <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 13px; color: #333; border: 1px solid ${colors.border};">
                <thead style="background-color: ${colors.headerBg};">
                    <tr>`;

        headers.forEach(h => {
            html += `<th style="padding: 12px 16px; border-bottom: 2px solid ${colors.border}; text-align: left; font-weight: 600; color: ${colors.headerText}; text-transform: none; font-size: 11px; letter-spacing: 0.05em;">${h}</th>`;
        });

        html += `</tr></thead><tbody>`;

        allData.forEach((row, index) => {
            // Zebra striping for better readability
            const bg = index % 2 === 0 ? '#ffffff' : colors.headerBg;
            html += `<tr style="background-color: ${bg};">`;

            headers.forEach(h => {
                let val = row[h];
                let cellStyle = `padding: 12px 16px; border-bottom: 1px solid ${colors.border}; vertical-align: top;`;

                if (fareColumns.includes(h) && val && !isNaN(parseFloat(val))) {
                    // Price formatting
                    html += `<td style="${cellStyle} text-align: right; font-family: Consolas, monospace; font-weight: 600; color: #111827;">${parseFloat(val).toFixed(2)}</td>`;
                } else {
                    // Regular text
                    html += `<td style="${cellStyle} color: #4b5563;">${val !== undefined ? val : ''}</td>`;
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
            alert("Table with Route & Date copied to clipboard!");
        }).catch(err => {
            console.error(err);
            alert("Failed to copy. See console.");
        });
    });
}
