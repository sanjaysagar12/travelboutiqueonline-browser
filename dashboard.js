// Dashboard Logic

let allData = [];
let fareColumns = [];
const baseColumns = ["Airline", "Flight #", "From", "Departure", "To", "Arrival", "Duration", "Stops"];
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
                const routeEl = document.getElementById('routeDisplay');
                const dateEl = document.getElementById('dateDisplay');

                if (result.flightInfo) {
                    let routeHtml = result.flightInfo.route || "Flight Results";
                    // Format: Origin <span>✈</span> Destination
                    if (routeHtml.toLowerCase().includes(" to ")) {
                        const parts = routeHtml.split(/ to /i);
                        routeHtml = `${parts[0]} <span>✈</span> ${parts[1]}`;
                    }
                    routeEl.innerHTML = routeHtml;
                    dateEl.textContent = result.flightInfo.date || "";
                } else if (allData.length > 0) {
                    const first = allData[0];
                    const fromCode = (first.From || first.Origin || '').toUpperCase();
                    const toCode = (first.To || first.Destination || '').toUpperCase();

                    const fromName = cityMapping[fromCode] || fromCode || 'From';
                    const toName = cityMapping[toCode] || toCode || 'To';

                    routeEl.innerHTML = `${fromName} <span>✈</span> ${toName}`;
                    dateEl.textContent = ""; // Keep it clean if no specific date is extracted
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

function getAirlineClass(airlineName) {
    if (!airlineName) return 'brand-default';
    const name = airlineName.toLowerCase();
    if (name.includes('indigo')) return 'brand-indigo';
    if (name.includes('air india')) return 'brand-airindia';
    if (name.includes('spicejet')) return 'brand-spicejet';
    if (name.includes('vistara')) return 'brand-vistara';
    if (name.includes('akasa')) return 'brand-akasa';
    return 'brand-default';
}

function getAirlineColor(airlineName) {
    if (!airlineName) return '#94a3b8';
    const name = airlineName.toLowerCase();
    if (name.includes('indigo')) return '#1a3c8d';
    if (name.includes('air india')) return '#e21d26';
    if (name.includes('spicejet')) return '#f30000';
    if (name.includes('vistara')) return '#5d2547';
    if (name.includes('akasa')) return '#ff5000';
    return '#94a3b8';
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
        // Keep airline left for better UI
        if (col === "Airline") th.style.textAlign = 'left';
        thead.appendChild(th);
    });

    // Rows
    tbody.innerHTML = '';
    allData.forEach(flight => {
        const tr = document.createElement('tr');
        tr.className = 'flight-row';

        allHeaders.forEach(col => {
            // Only render cells for checked columns
            if (!columnVisibility[col]) return;

            const td = document.createElement('td');
            const val = flight[col];

            if (col === "Airline") {
                td.textContent = val !== undefined ? val : '';
                td.style.textAlign = 'left';
            } else if (fareColumns.includes(col)) {
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
function copyForEmail() {
    if (allData.length === 0) return alert("No data to copy");

    chrome.storage.local.get(['flightInfo'], (result) => {
        const info = result.flightInfo || {};
        let routeHtml = info.route || "Flight Results";
        if (routeHtml.toLowerCase().includes(" to ")) {
            const parts = routeHtml.split(/ to /i);
            routeHtml = `${parts[0]} <span style="color: #9ca3af; margin: 0 10px;">✈</span> ${parts[1]}`;
        }
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
            blue: { headerBg: '#f8fafc', headerText: '#1a3c8d', border: '#e5e7eb' },
            green: { headerBg: '#f0fdf4', headerText: '#047857', border: '#d1d5db' }
        };
        const colors = themeColors[currentTheme];

        // Robust email structure (Nested tables for centering and spacing)
        let html = `
            <div style="background-color: #f0f2f5; padding: 40px 20px; font-family: 'Segoe UI', Tahoma, Verdana, sans-serif;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 900px; margin: 0 auto; background-color: white; border-radius: 12px; border: 1px solid #e5e7eb; padding: 24px;">
                    <tr>
                        <td>
                            <!-- Header Section -->
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-bottom: 1px solid #e5e7eb; padding-bottom: 24px; margin-bottom: 20px;">
                                <tr>
                                    <td align="center">
                                        <span style="font-size: 20px; font-weight: 600; color: ${colors.headerText};">${routeHtml}</span>
                                        <span style="height: 24px; width: 1px; background: #d1d5db; margin: 0 24px; display: inline-block; vertical-align: middle;"></span>
                                        <span style="color: #4b5563; font-weight: 500; font-size: 16px; vertical-align: middle;">${date}</span>
                                    </td>
                                </tr>
                            </table>

                            <!-- Table Header -->
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <thead>
                                    <tr>`;

        headers.forEach(h => {
            let align = (h === "Airline") ? "left" : "center";
            html += `<th style="padding: 0 16px; text-align: ${align}; font-weight: 700; color: #000; font-size: 12px;">${h}</th>`;
        });

        html += `           </tr>
                                </thead>
                                <tbody>`;

        // Flight Rows (Each as a separate nested table for the card-spacing effect)
        allData.forEach((row) => {
            html += `<tr><td colspan="${headers.length}" style="padding-top: 12px;">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-radius: 8px; border: 1px solid #e5e7eb; background-color: white;">
                            <tr class="flight-row">`;

            headers.forEach((h, i) => {
                let val = row[h];
                let isFirst = (i === 0);
                let isLast = (i === headers.length - 1);
                
                let cellStyle = `
                    padding: 16px; 
                    text-align: center;
                    font-size: 14px;
                    color: #000;
                    ${isFirst ? 'text-align: left;' : ''}
                `;

                if (h === "Airline") {
                    html += `<td style="${cellStyle}">${val !== undefined ? val : ''}</td>`;
                } else if (fareColumns.includes(h) && val && !isNaN(parseFloat(val))) {
                    html += `<td style="${cellStyle} font-weight: 700;">${parseFloat(val).toFixed(2)}</td>`;
                } else {
                    html += `<td style="${cellStyle}">${val !== undefined ? val : ''}</td>`;
                }
            });

            html += `       </tr>
                        </table>
                    </td></tr>`;
        });

        html += `           </tbody>
                            </table>
                        </td>
                    </tr>
                </table>
            </div>`;

        // Copy HTML to clipboard
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobText = new Blob([html], { type: 'text/plain' });

        const item = new ClipboardItem({
            'text/html': blobHtml,
            'text/plain': blobText
        });

        navigator.clipboard.write([item]).then(() => {
            alert("Modern Dashboard UI copied to clipboard!");
        }).catch(err => {
            console.error(err);
            alert("Failed to copy. See console.");
        });
    });
}
