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
        const marker = L.circleMarker([s.lat, s.lng], {
            radius: 8,
            fillColor: "#007AFF",
            color: "#fff",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map).bindPopup(`<b>${s.name}</b>`);

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

// 3. Sidebar Rendering Logic
async function renderStationList(filter) {
    const list = document.getElementById('map-station-list');
    list.innerHTML = '';
    // Determine selected date
    const dateInput = document.getElementById('calendar-date');
    let selected = null;
    if (dateInput && dateInput.value) selected = new Date(dateInput.value);

    // If a date is selected, fetch CSV value for Wakad for that day/month
    let wakadValue = '--';
    if (selected) {
        const day = selected.getDate();
        const monthName = selected.toLocaleString('default', { month: 'long' });
        wakadValue = await fetchAQIFromCSV(day, monthName);
    }

    stations.filter(s => filter === 'all' || s.area === filter).forEach(s => {
        const isWakad = s.name.toLowerCase().includes("wakad");
        const displayAQI = isWakad ? wakadValue : "--";
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

    // Calendar date input handling
    const dateInput = document.getElementById('calendar-date');
    if (dateInput) {
        // default to Jan 1, 2024 if empty
        if (!dateInput.value) dateInput.value = '2024-01-01';
        dateInput.addEventListener('change', () => renderStationList('all'));
    }
}

// 5. Utility Helpers
function getColorForAQI(aqi) {
    if (aqi <= 50) return '#10b981'; // Good (Green)
    if (aqi <= 100) return '#f59e0b'; // Moderate (Yellow)
    if (aqi <= 200) return '#f97316'; // Poor (Orange)
    return '#ef4444'; // Very Poor (Red)
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