// --- App State ---
let map;
const mapMarkers = {};
const stations = [
    // Pune (13)
    { name: "Shivajinagar", area: "pune", lat: 18.531, lng: 73.844 },
    { name: "Pashan", area: "pune", lat: 18.541, lng: 73.805 },
    { name: "Lohegaon", area: "pune", lat: 18.591, lng: 73.919 },
    { name: "Katraj", area: "pune", lat: 18.452, lng: 73.854 },
    { name: "Hadapsar", area: "pune", lat: 18.508, lng: 73.926 },
    { name: "Kothrud", area: "pune", lat: 18.507, lng: 73.807 },
    { name: "Karve Road", area: "pune", lat: 18.509, lng: 73.833 },
    { name: "Katraj Dairy", area: "pune", lat: 18.459, lng: 73.856 },
    { name: "SPPU (Ganeshkhind)", area: "pune", lat: 18.553, lng: 73.824 },
    { name: "Manjri", area: "pune", lat: 18.525, lng: 73.978 },
    { name: "Alandi", area: "pune", lat: 18.675, lng: 73.889 },
    { name: "Yerwada", area: "pune", lat: 18.552, lng: 73.883 },
    { name: "Dhayari", area: "pune", lat: 18.448, lng: 73.809 },
    // PCMC (4)
    { name: "Bhosari", area: "pcmc", lat: 18.621, lng: 73.845 },
    { name: "Nigdi", area: "pcmc", lat: 18.649, lng: 73.771 },
    { name: "Park Street, Wakad", area: "pcmc", lat: 18.597, lng: 73.779 },
    { name: "Thergaon", area: "pcmc", lat: 18.599, lng: 73.784 }
];

// 1. Initialize Leaflet Map
function initMap() {
    // Center map on Pune
    map = L.map('map', { zoomControl: false }).setView([18.5204, 73.8567], 12);

    // Dark Mode Tiles (CartoDB)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Add Circle Markers for each station and save references
    stations.forEach(s => {
        const popupId = `popup-${encodeURIComponent(s.name)}`;
        const marker = L.circleMarker([s.lat, s.lng], {
            radius: 10,
            fillColor: "#007AFF",
            color: "#fff",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(map).bindPopup(`<b>${s.name}</b><div id="${popupId}">AQI: --</div>`);

        // clicking a marker recenters and zooms
        marker.on('click', () => {
            map.flyTo([s.lat, s.lng], 15, { duration: 1.2 });
        });

        mapMarkers[s.name] = marker;
    });
}

// 2. CSV Data Fetching (Wakad Only)
async function fetchWakadAQI() {
    try {
        const response = await fetch('wakad_aqi.csv');
        const text = await response.text();
        const rows = text.split('\n').filter(row => row.trim() !== '');
        
        if (rows.length > 1) {
            const lastRow = rows[rows.length - 1].split(',');
            return lastRow[1]; // Assuming AQI value is in the 2nd column
        }
    } catch (e) {
        console.warn("Wakad CSV data currently unavailable.");
    }
    return "--";
}

// Fetch AQI value for a given day and month (monthName expected like 'January')
async function fetchAQIFromCSV(day, monthName) {
    try {
        const resp = await fetch('wakad_aqi.csv');
        const text = await resp.text();
        const rows = text.split('\n').map(r => r.split(','));
        if (rows.length < 2) return "--";

        const header = rows[0].map(h => h.trim());
        const monthIndex = header.findIndex(h => h.toLowerCase() === monthName.toLowerCase());
        if (monthIndex === -1) return "--";

        // Find row matching day (first column)
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i];
            if (!cols || cols.length === 0) continue;
            const rowDay = cols[0].trim();
            if (rowDay === String(day)) {
                const val = cols[monthIndex] ? cols[monthIndex].trim() : '';
                return val === '' ? '--' : val;
            }
        }
    } catch (e) {
        console.warn('CSV fetch error', e);
    }
    return "--";
}

// --- Minimal CSV helpers for all stations (non-invasive) ---
const csvCache = {};
const stationCsvMap = {
    "Alandi": "alandi.csv",
    "Bhosari": "bhosari.csv",
    "Hadapsar": "hadapsar.csv",
    "Karve Road": "karve.csv",
    "Katraj": "katraj.csv",
    "Kothrud": "mit-kothrud.csv",
    "Katraj Dairy": "katraj.csv",
    "Park Street, Wakad": "wakad_aqi.csv",
    "Thergaon": "thergaon.csv",
    "SPPU (Ganeshkhind)": "savitribai.csv",
    "Dhayari": "bhumkar.csv",
    "Lohegaon": "park.csv",
    "Nigdi": "park.csv",
    // User-requested mappings
    "Shivajinagar": "revenue.csv",
    "Manjri": "park.csv",
    "Yerwada": "gavalinagar.csv",
    "Pashan": "panchawati.csv",
};

function guessCsvFilenameFromName(name) {
    const normalized = name.toLowerCase()
        .replace(/\(.*\)/, '')
        .replace(/[.,']/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
    return `${normalized}.csv`;
}

// caches for raw text and auto-refresh
const csvTextCache = {};
let autoRefreshEnabled = false;
let autoRefreshHandle = null;
const AUTO_REFRESH_INTERVAL = 15000; // 15s default

async function loadCsvData(filename, textOverride = null) {
    if (!filename) return null;
    // if already cached and no override, return
    if (textOverride === null && csvCache[filename] !== undefined) return csvCache[filename];
    try {
        let text;
        if (textOverride !== null) {
            text = textOverride;
        } else {
            const resp = await fetch(filename);
            if (!resp.ok) throw new Error('not found');
            text = await resp.text();
        }

        // store raw text for change detection
        csvTextCache[filename] = text;

        const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');
        if (lines.length === 0) {
            csvCache[filename] = null;
            return null;
        }

        const parsed = lines.map(l => l.split(',').map(c => c.trim()));
        const firstRow = parsed[0].map(c => c.toLowerCase());
        const hasHeader = firstRow.some(c => c === 'day' || c === 'january' || c === 'date');

        // If there's no explicit header but the first column looks like a day (e.g. "16")
        // and there are 13 columns (Day + 12 months), infer a month header so date-based
        // lookups work for files that omit a header row.
        let data;
        if (hasHeader) {
            data = { header: parsed[0], rows: parsed.slice(1) };
        } else {
            const columns = parsed[0].length || 0;
            const firstCell = parsed[0][0] ? parsed[0][0].trim() : '';
            const looksLikeDay = /^\d{1,2}$/.test(firstCell);
            if (looksLikeDay && columns >= 13) {
                const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
                const inferredHeader = ['Day'].concat(monthNames.slice(0, columns - 1));
                console.log('[csv] inferred header for', filename, inferredHeader);
                data = { header: inferredHeader, rows: parsed };
            } else {
                data = { header: null, rows: parsed };
            }
        }

        csvCache[filename] = data;
        return data;
    } catch (e) {
        csvCache[filename] = null;
        return null;
    }
}

function getLatestFromCsvData(data) {
    if (!data) return '--';
    // Only consider rows where the first column is a day number (1-31)
    for (let i = data.rows.length - 1; i >= 0; i--) {
        const row = data.rows[i];
        const dayCell = row[0] ? row[0].trim() : '';
        if (!/^\d{1,2}$/.test(dayCell)) continue; // skip summary/footer rows like 'Good'

        // look for a positive numeric value in month columns (usually columns 1..)
        for (let j = row.length - 1; j >= 1; j--) {
            const v = row[j] ? row[j].trim() : '';
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) return String(n);
        }
    }
    return '--';
}

async function getAQIForStation(name, day = null, monthName = null, dateIso = null) {
    const filename = stationCsvMap[name] || guessCsvFilenameFromName(name);
    const data = await loadCsvData(filename);
    if (!data) return '--';

    // If CSV uses a Date,AQI layout (header contains 'date' or rows have ISO dates),
    // prefer an exact ISO date lookup when provided (e.g., '2024-12-31').
    if (dateIso && data.header) {
        const headerLower = data.header.map(h => h.trim().toLowerCase());
        if (headerLower.includes('date')) {
            // Exact match only: prefer an exact ISO date lookup (e.g., '2024-12-31')
            for (let i = 0; i < data.rows.length; i++) {
                const row = data.rows[i];
                const rowDate = row[0] ? row[0].trim() : '';
                if (rowDate === dateIso || rowDate.startsWith(dateIso)) {
                    const v = row[1] ? row[1].trim() : '';
                    return v === '' ? '--' : v;
                }
            }
            // No exact date found -> return missing
            return '--';
        }
    }

    // Also handle CSVs without headers but where first column looks like an ISO date
    if (dateIso) {
        // Exact match only for ISO date rows
        for (let i = 0; i < data.rows.length; i++) {
            const row = data.rows[i];
            const rowDate = row[0] ? row[0].trim() : '';
            if (/^\d{4}-\d{2}-\d{2}$/.test(rowDate) && (rowDate === dateIso || rowDate.startsWith(dateIso))) {
                const v = row[1] ? row[1].trim() : '';
                return v === '' ? '--' : v;
            }
        }
        return '--';
    }

    if (day && monthName && data.header) {
        const header = data.header.map(h => h.trim().toLowerCase());
        const idx = header.findIndex(h => h === monthName.toLowerCase());
        if (idx === -1) return '--';
        for (let i = 0; i < data.rows.length; i++) {
            const row = data.rows[i];
            const rowDay = row[0] ? row[0].trim() : '';
            if (rowDay === String(day)) {
                const v = row[idx] ? row[idx].trim() : '';
                return v === '' ? '--' : v;
            }
        }
        return '--';
    }

    // fallback: latest numeric
    return getLatestFromCsvData(data);
}

// --- Heatmap helpers (leaflet.heat) ---
let heatLayer = null;
let heatVisible = false;

function normalizeAQIForHeat(aqi) {
    const n = parseFloat(aqi);
    if (isNaN(n) || n <= 0) return 0.25; // stronger baseline so heat areas overlap more
    // clamp to reasonable range and scale between 0.25 - 1
    const clamped = Math.min(Math.max(n, 0), 300);
    return 0.25 + 0.75 * (clamped / 300);
}

async function buildHeatPoints(day = null, monthName = null, dateIso = null) {
    const pts = await Promise.all(stations.map(async s => {
        const aqi = await getAQIForStation(s.name, day, monthName, dateIso);
        const w = normalizeAQIForHeat(aqi);
        return [s.lat, s.lng, w];
    }));
    return pts.filter(p => p && p[2] > 0);
}

async function createOrUpdateHeatmap(day = null, monthName = null, dateIso = null) {
    console.log('[heat] createOrUpdateHeatmap called', { day, monthName, dateIso, heatVisible });
    const points = await buildHeatPoints(day, monthName, dateIso);
    console.log('[heat] built points count=', points.length, 'sample=', points.slice(0,4));
    // show small debug banner for heat diagnostics
    try {
        let hb = document.getElementById('heat-debug');
        if (!hb) {
            hb = document.createElement('div');
            hb.id = 'heat-debug';
            hb.style.position = 'absolute';
            hb.style.right = '16px';
            hb.style.bottom = '16px';
            hb.style.zIndex = 6500;
            hb.style.background = 'rgba(0,0,0,0.6)';
            hb.style.color = 'white';
            hb.style.padding = '8px 10px';
            hb.style.borderRadius = '8px';
            hb.style.fontSize = '12px';
            document.body.appendChild(hb);
        }
        hb.textContent = `Heat: pts=${points.length}`;
    } catch(e) { console.warn('[heat] debug banner failed', e); }

    if (!window.L || typeof L.heatLayer !== 'function') {
        console.warn('[heat] Leaflet.heat plugin not available (L.heatLayer missing)');
        const el = document.getElementById('heat-debug');
        if (el) el.textContent = 'Heat: plugin missing';
        return;
    }

    if (heatLayer) { try { map.removeLayer(heatLayer); } catch(e){console.warn('[heat] remove old failed', e);} heatLayer = null; }
    heatLayer = L.heatLayer(points, {
        radius: 80,
        blur: 50,
        maxZoom: 16,
        max: 1.0,
        gradient: {0.1: 'green', 0.35: 'yellow', 0.6: 'orange', 1.0: 'red'}
    });
    if (heatVisible && map) {
        heatLayer.addTo(map);
        console.log('[heat] heatLayer added to map');
    } else {
        console.log('[heat] heatLayer created but not added (heatVisible=', heatVisible, ')');
    }
}

// CSV refresh helpers
async function refreshCsv(filename) {
    if (!filename) return false;
    try {
        const resp = await fetch(filename + '?_ts=' + Date.now());
        if (!resp.ok) return false;
        const text = await resp.text();
        if (csvTextCache[filename] === text) return false;
        // update parsed data in-place
        await loadCsvData(filename, text);
        console.log('[csv] refreshed', filename);
        return true;
    } catch (e) {
        console.warn('[csv] refresh failed', filename, e);
        return false;
    }
}

async function refreshAllCsvs() {
    const filenames = new Set(Object.values(stationCsvMap));
    stations.forEach(s => filenames.add(stationCsvMap[s.name] || guessCsvFilenameFromName(s.name)));
    let changed = false;
    for (const f of filenames) {
        if (!f) continue;
        const did = await refreshCsv(f);
        changed = changed || did;
    }
    // update UI/time even when nothing changed so user sees we checked
    updateLastRefresh();
    if (changed) {
        console.log('[csv] changes detected, re-rendering');
        // re-render list and heatmap
        const dateInput = document.getElementById('calendar-date');
        const selected = dateInput && dateInput.value ? new Date(dateInput.value) : null;
        const day = selected ? selected.getDate() : null;
        const monthName = selected ? selected.toLocaleString('default', { month: 'long' }) : null;
        const dateIso = selected ? selected.toISOString().slice(0,10) : null;
        renderStationList('all');
        if (heatVisible) createOrUpdateHeatmap(day, monthName, dateIso);
    }
}

function updateLastRefresh() {
    const el = document.getElementById('last-refresh');
    if (el) el.textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

function startAutoRefresh() {
    if (autoRefreshEnabled) return;
    autoRefreshEnabled = true;
    autoRefreshHandle = setInterval(refreshAllCsvs, AUTO_REFRESH_INTERVAL);
    const el = document.getElementById('toggle-auto-refresh');
    if (el) el.classList.add('active');
    updateLastRefresh();
}

function stopAutoRefresh() {
    if (!autoRefreshEnabled) return;
    autoRefreshEnabled = false;
    clearInterval(autoRefreshHandle);
    autoRefreshHandle = null;
    const el = document.getElementById('toggle-auto-refresh');
    if (el) el.classList.remove('active');
}

// 3. Sidebar Rendering Logic

// 3. Sidebar Rendering Logic
async function renderStationList(filter) {
    const list = document.getElementById('map-station-list');
    list.innerHTML = '';
    // Determine selected date
    const dateInput = document.getElementById('calendar-date');
    let selected = null;
    if (dateInput && dateInput.value) selected = new Date(dateInput.value);

    // Prepare date info
    const day = selected ? selected.getDate() : null;
    const monthName = selected ? selected.toLocaleString('default', { month: 'long' }) : null;
    const dateIso = selected ? selected.toISOString().slice(0,10) : null;

    const visible = stations.filter(s => filter === 'all' || s.area === filter);

    // Fetch AQI for visible stations in parallel to avoid blocking
    const items = await Promise.all(visible.map(async (s) => {
        try {
            const value = await getAQIForStation(s.name, day, monthName, dateIso);
            return { s, value };
        } catch (e) {
            return { s, value: '--' };
        }
    }));

    items.forEach(({ s, value: displayAQI }) => {
        const aqiNum = parseInt(displayAQI);
        const statusColor = (!isNaN(aqiNum)) ? getColorForAQI(aqiNum) : "#555";

        const card = document.createElement('div');
        card.className = "station-card p-4 rounded-2xl relative overflow-hidden flex items-center justify-between";
        card.style.borderLeft = `5px solid ${statusColor}`;

        const left = document.createElement('div');
        left.innerHTML = `
            <div>
                <span class="text-[10px] text-blue-500 font-bold uppercase tracking-widest">${s.area}</span>
                <h4 class="text-sm font-semibold text-white mt-1">${s.name}</h4>
            </div>
        `;

        const right = document.createElement('div');
        right.className = 'flex flex-col items-end gap-2';
        right.innerHTML = `<div class="text-2xl font-bold" style="color: ${statusColor}">${displayAQI}</div>`;

        const btns = document.createElement('div');
        btns.className = 'flex gap-2';

        const centerBtn = document.createElement('button');
        centerBtn.className = 'text-xs bg-white/10 px-3 py-1 rounded-full';
        centerBtn.textContent = 'Center';
        centerBtn.onclick = (e) => {
            e.stopPropagation();
            map.flyTo([s.lat, s.lng], 15, { duration: 1.2 });
        };

        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'text-xs bg-white/10 px-3 py-1 rounded-full';
        detailsBtn.textContent = 'Details';
        detailsBtn.onclick = (e) => {
            e.stopPropagation();
            const url = `pune-details.html?station=${encodeURIComponent(s.name)}`;
            window.open(url, '_blank');
        };

        btns.appendChild(centerBtn);
        btns.appendChild(detailsBtn);
        right.appendChild(btns);

        card.appendChild(left);
        card.appendChild(right);

        list.appendChild(card);

        // update marker popup and style too
        try { updateMarkerAQI(s.name, displayAQI); } catch (e) { /* ignore */ }
    });
}

// (Pune center widget removed) no widget updater

// 4. Sidebar UI Interactions
function initMapPanelLogic() {
    const allBtn = document.getElementById('filter-all');
    const puneBtn = document.getElementById('filter-pune');
    const pcmcBtn = document.getElementById('filter-pcmc');
    const upBtn = document.getElementById('station-scroll-up');
    const downBtn = document.getElementById('station-scroll-down');
    const listEl = document.getElementById('map-station-list');

    if (allBtn) allBtn.onclick = () => renderStationList('all');
    if (puneBtn) puneBtn.onclick = () => renderStationList('pune');
    if (pcmcBtn) pcmcBtn.onclick = () => renderStationList('pcmc');

    // Scroll buttons
    const SCROLL_AMOUNT = 100;
    if (upBtn && listEl) upBtn.onclick = () => listEl.scrollBy({ top: -SCROLL_AMOUNT, behavior: 'smooth' });
    if (downBtn && listEl) downBtn.onclick = () => listEl.scrollBy({ top: SCROLL_AMOUNT, behavior: 'smooth' });

    // Keyboard support when list is focused
    if (listEl) {
        listEl.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); listEl.scrollBy({ top: 40, behavior: 'smooth' }); }
            if (e.key === 'ArrowUp') { e.preventDefault(); listEl.scrollBy({ top: -40, behavior: 'smooth' }); }
            if (e.key === 'PageDown') { e.preventDefault(); listEl.scrollBy({ top: 200, behavior: 'smooth' }); }
            if (e.key === 'PageUp') { e.preventDefault(); listEl.scrollBy({ top: -200, behavior: 'smooth' }); }
            if (e.key === 'Home') { e.preventDefault(); listEl.scrollTo({ top: 0, behavior: 'smooth' }); }
            if (e.key === 'End') { e.preventDefault(); listEl.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' }); }
        });
    }

    // render default list
    renderStationList('all');

    // Heatmap toggle button
    const heatBtn = document.getElementById('toggle-heat');
    if (heatBtn) {
        heatBtn.onclick = async () => {
            heatVisible = !heatVisible;
            heatBtn.classList.toggle('active', heatVisible);
            const dateInput = document.getElementById('calendar-date');
            const selected = dateInput && dateInput.value ? new Date(dateInput.value) : null;
            const day = selected ? selected.getDate() : null;
            const monthName = selected ? selected.toLocaleString('default', { month: 'long' }) : null;
            const dateIso = selected ? selected.toISOString().slice(0,10) : null;
            if (heatVisible) {
                await createOrUpdateHeatmap(day, monthName, dateIso);
            } else {
                heatLayer && map.removeLayer(heatLayer);
            }
            // sync floating btn if present
            const floatBtn = document.getElementById('heat-floating-btn');
            if (floatBtn) floatBtn.classList.toggle('active', heatVisible);
        };
    }

    // Floating heat button overlay on map (visible even if sidebar is collapsed)
    const heatFloatBtn = document.getElementById('heat-floating-btn');
    if (heatFloatBtn) {
        heatFloatBtn.onclick = async () => {
            heatVisible = !heatVisible;
            heatFloatBtn.classList.toggle('active', heatVisible);
            const toggleBtn = document.getElementById('toggle-heat');
            if (toggleBtn) toggleBtn.classList.toggle('active', heatVisible);
            const dateInput = document.getElementById('calendar-date');
            const selected = dateInput && dateInput.value ? new Date(dateInput.value) : null;
            const day = selected ? selected.getDate() : null;
            const monthName = selected ? selected.toLocaleString('default', { month: 'long' }) : null;
            const dateIso = selected ? selected.toISOString().slice(0,10) : null;
            if (heatVisible) {
                await createOrUpdateHeatmap(day, monthName, dateIso);
            } else {
                heatLayer && map.removeLayer(heatLayer);
            }
        };
    }
    // Refresh controls
    const refreshBtn = document.getElementById('refresh-data');
    const autoBtn = document.getElementById('toggle-auto-refresh');
    if (refreshBtn) refreshBtn.onclick = async () => { refreshBtn.disabled = true; await refreshAllCsvs(); refreshBtn.disabled = false; };
    if (autoBtn) autoBtn.onclick = () => { if (autoRefreshEnabled) stopAutoRefresh(); else startAutoRefresh(); };
    // Calendar date input handling
    const dateInput = document.getElementById('calendar-date');
    if (dateInput) {
        // default to Jan 1, 2024 if empty
        if (!dateInput.value) dateInput.value = '2024-01-01';
        dateInput.addEventListener('change', () => {
            renderStationList('all');
            if (heatVisible) {
                const selected = dateInput.value ? new Date(dateInput.value) : null;
                const day = selected ? selected.getDate() : null;
                const monthName = selected ? selected.toLocaleString('default', { month: 'long' }) : null;
                const dateIso = selected ? selected.toISOString().slice(0,10) : null;
                createOrUpdateHeatmap(day, monthName, dateIso);
            }
        });
    }
}

// 5. Utility Helpers
function getColorForAQI(aqi) {
    const n = parseFloat(aqi);
    if (isNaN(n)) return '#555';
    if (n <= 50) return '#10b981'; // Good (Green)
    if (n <= 100) return '#f59e0b'; // Moderate (Yellow)
    if (n <= 200) return '#f97316'; // Poor (Orange)
    return '#ef4444'; // Very Poor (Red)
}

// Update a marker's color and popup with an AQI value
function updateMarkerAQI(stationName, aqiValue) {
    const marker = mapMarkers[stationName];
    if (!marker) return;
    try {
        const color = getColorForAQI(aqiValue);
        // set style if supported
        if (marker.setStyle) marker.setStyle({ fillColor: color, radius: 10 + (isNaN(parseFloat(aqiValue)) ? 0 : Math.min(6, Math.round(parseFloat(aqiValue)/50))) });
        const popupId = `popup-${encodeURIComponent(stationName)}`;
        const popupContent = `<b>${stationName}</b><div id="${popupId}">AQI: ${aqiValue}</div>`;
        marker.bindPopup(popupContent);
    } catch (e) {
        console.warn('updateMarkerAQI failed', stationName, e);
    }
}

function filterStations(area) {
    renderStationList(area);
}

// Bind Global Filter Helper
window.filterStations = filterStations;

// Start the Application
window.onload = () => {
    initMap();
    initMapPanelLogic();
};