// --- Main Application Logic ---
let map;
let directionsService;
let directionsRenderer;
let isDemoMode = false;

if (!CONFIG.GOOGLE_API_KEY || CONFIG.GOOGLE_API_KEY === "YOUR_API_KEY_HERE") {
    isDemoMode = true;
}

// --- Initialization ---
async function initApp() {
    if (isDemoMode) { initDemoMode(); } else { await initMap(); }
    const form = document.getElementById('route-form');
    if (form) form.addEventListener('submit', handleRouteRequest);
    initSidebarLogic();
    initCurrentLocationAQI();
}

// --- Online Mode (Google Maps) ---
async function initMap() {
    try {
        const { Map } = await google.maps.importLibrary("maps");
        const { DirectionsService, DirectionsRenderer } = await google.maps.importLibrary("routes");
        map = new Map(document.getElementById("map"), {
            center: { lat: 18.5204, lng: 73.8567 },
            zoom: 12,
            mapId: "4504f8b37365c3d0",
        });
        directionsService = new DirectionsService();
        directionsRenderer = new DirectionsRenderer({
            map: map,
            polylineOptions: { strokeColor: "#007AFF", strokeOpacity: 0.8, strokeWeight: 6 }
        });
        document.getElementById('map-placeholder').style.display = 'none';
    } catch (error) {
        isDemoMode = true;
        initDemoMode();
    }
}

// =========================================
// SIDE PANEL & REAL DATA LOGIC
// =========================================

const aqiStations = [
    { name: "Shivajinagar", area: "pune", lat: 18.531, lng: 73.844 },
    { name: "Pashan", area: "pune", lat: 18.541, lng: 73.805 },
    { name: "Park Street, Wakad", area: "pcmc", lat: 18.597, lng: 73.779 },
    { name: "Bhosari", area: "pcmc", lat: 18.621, lng: 73.845 },
    // ... add others as needed
];

async function fetchWakadAQI() {
    try {
        const response = await fetch('wakad_aqi.csv');
        const text = await response.text();
        const rows = text.split('\n').filter(row => row.trim() !== '');
        
        if (rows.length > 1) {
            const lastRow = rows[rows.length - 1].split(',');
            return lastRow[1]; // Assuming AQI is the second column
        }
    } catch (e) {
        console.warn("Wakad CSV not loaded yet.");
    }
    return "--";
}

async function renderStationList(filter) {
    const list = document.getElementById('station-list-container');
    list.innerHTML = '';
    
    // Fetch real Wakad data before rendering
    const wakadValue = await fetchWakadAQI();

    aqiStations.filter(s => filter === 'all' || s.area === filter).forEach(s => {
        const isWakad = s.name.includes("Wakad");
        const displayAQI = isWakad ? wakadValue : "Pending";
        const statusColor = isWakad && displayAQI !== "--" ? getColorForAQI(parseInt(displayAQI)) : "#555";

        const card = document.createElement('div');
        card.className = "station-card p-6 mb-4 rounded-2xl relative overflow-hidden";
        card.style.borderLeft = `5px solid ${statusColor}`;
        card.innerHTML = `
            <div class="flex justify-between items-center">
                <div>
                    <span class="text-[10px] text-blue-500 font-bold uppercase tracking-widest">${s.area}</span>
                    <h4 class="text-xl font-semibold text-white mt-1">${s.name}</h4>
                    <p class="text-gray-500 text-xs mt-1">Real-time Station Data</p>
                </div>
                <div class="text-right">
                    <span class="text-2xl font-bold" style="color: ${statusColor}">${displayAQI}</span>
                    <p class="text-[10px] text-gray-600 uppercase">AQI</p>
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

function initSidebarLogic() {
    const sidebar = document.getElementById('details-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const trigger = document.getElementById('learn-more-trigger');
    const closeBtn = document.getElementById('close-sidebar');

    const toggle = (state) => {
        sidebar.classList.toggle('open', state);
        overlay.classList.toggle('active', state);
        if (state) renderStationList('all');
    };

    if (trigger) trigger.onclick = () => toggle(true);
    if (closeBtn) closeBtn.onclick = () => toggle(false);
    if (overlay) overlay.onclick = () => toggle(false);
}

// Global filter helper
window.filterStations = (area) => renderStationList(area);

// (Existing Helper Functions Below)
function getColorForAQI(aqi) {
    if (aqi <= 50) return '#10b981';
    if (aqi <= 100) return '#f59e0b';
    return '#ef4444';
}

// Bootstrap
if (window.google && window.google.maps) { initApp(); } else { window.initMap = initApp; if (isDemoMode) initApp(); }