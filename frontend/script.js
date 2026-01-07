// Main Application Logic
// Handles both Online (Real API) and Offline (Demo) modes

let map;
let directionsService;
let directionsRenderer;
let isDemoMode = false;

// Check for API Key
if (!CONFIG.GOOGLE_API_KEY || CONFIG.GOOGLE_API_KEY === "YOUR_API_KEY_HERE") {
  isDemoMode = true;
}

// --- Initialization ---

async function initApp() {
  console.log("Initializing App...");

  if (isDemoMode) {
    initDemoMode();
  } else {
    await initMap();
  }

  // Setup Form Listener
  const form = document.getElementById('route-form');
  form.addEventListener('submit', handleRouteRequest);

  // Try to get current location AQI
  initCurrentLocationAQI();
}

async function initCurrentLocationAQI() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        // Use our existing fetchAQI function
        // If in demo mode, this might fail or we need to mock it.
        // For now, let's assume if we have a key we use it.
        if (!isDemoMode) {
          const aqiData = await fetchAQI(lat, lng);
          if (aqiData && aqiData.indexes && aqiData.indexes.length > 0) {
            const aqi = aqiData.indexes[0].aqi;
            displayLocalAQI(aqi);
          }
        } else {
          // Mock for demo
          displayLocalAQI(Math.floor(Math.random() * 50) + 30);
        }
      } catch (e) {
        console.warn("Failed to fetch local AQI", e);
      }
    }, (error) => {
      console.warn("Geolocation permission denied or failed", error);
    });
  }
}

function displayLocalAQI(aqi) {
  const container = document.getElementById('current-aqi-display');
  const valueSpan = document.getElementById('local-aqi-value');

  if (container && valueSpan) {
    valueSpan.innerText = aqi;
    valueSpan.style.color = getColorForAQI(aqi);
    container.classList.remove('hidden');
    container.classList.add('flex'); // Ensure flex display
  }
}

// --- Online Mode (Google Maps) ---

async function initMap() {
  try {
    console.log("Loading Google Maps...");
    const { Map } = await google.maps.importLibrary("maps");
    const { DirectionsService, DirectionsRenderer } = await google.maps.importLibrary("routes");

    map = new Map(document.getElementById("map"), {
      center: { lat: 19.0760, lng: 72.8777 }, // Mumbai
      zoom: 12,
      mapId: "4504f8b37365c3d0",
      disableDefaultUI: false,
      // ... (Styles would go here, keeping it brief for reliability)
    });

    directionsService = new DirectionsService();
    directionsRenderer = new DirectionsRenderer({
      map: map,
      polylineOptions: { strokeColor: "#3b82f6", strokeOpacity: 0.6, strokeWeight: 6 }
    });

    document.getElementById('map-placeholder').style.display = 'none';

  } catch (error) {
    console.error("Failed to load Google Maps:", error);
    alert("Failed to load Maps API. Switching to Demo Mode.");
    isDemoMode = true;
    initDemoMode();
  }
}

// --- Offline / Demo Mode ---

function initDemoMode() {
  console.log("Initializing Demo Mode...");

  // Hide placeholder
  const placeholder = document.getElementById('map-placeholder');
  placeholder.innerHTML = `
        <div class="text-center p-8">
            <div class="mb-4 text-yellow-500">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h3 class="text-2xl font-bold text-white mb-2">Demo Mode Active</h3>
            <p class="text-gray-400 mb-6">Google Maps API Key is missing. Using simulated map and data.</p>
            <div class="w-full h-64 bg-gray-800 rounded-xl border border-white/10 flex items-center justify-center relative overflow-hidden">
                <!-- Fake Map Background -->
                <div class="absolute inset-0 opacity-20" style="background-image: radial-gradient(#4b5563 1px, transparent 1px); background-size: 20px 20px;"></div>
                <div class="absolute top-1/2 left-1/4 w-3 h-3 bg-blue-500 rounded-full shadow-[0_0_10px_#3b82f6]"></div>
                <div class="absolute top-1/3 right-1/4 w-3 h-3 bg-red-500 rounded-full shadow-[0_0_10px_#ef4444]"></div>
                <svg class="absolute inset-0 w-full h-full text-blue-500/40" style="filter: drop-shadow(0 0 2px #3b82f6);">
                     <path d="M 200 300 Q 400 100 600 200" stroke="currentColor" stroke-width="4" fill="none" />
                </svg>
                <span class="relative z-10 bg-black/50 px-4 py-2 rounded-lg backdrop-blur-sm border border-white/10">Interactive Map Unavailable</span>
            </div>
        </div>
    `;
  placeholder.style.display = 'flex'; // Ensure it's visible but with new content
}

// --- Route Handling ---

function handleRouteRequest(e) {
  e.preventDefault();
  const origin = document.getElementById('origin-input').value;
  const destination = document.getElementById('destination-input').value;

  if (!origin || !destination) {
    alert("Please enter both origin and destination.");
    return;
  }

  const submitBtn = document.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerText;
  submitBtn.innerText = "Calculating Best Route...";
  submitBtn.disabled = true;

  // Simulate network delay
  setTimeout(() => {
    if (isDemoMode) {
      calculateDemoRoute(origin, destination);
    } else {
      calculateRealRoute(origin, destination);
    }
    submitBtn.innerText = originalText;
    submitBtn.disabled = false;
  }, 1500);
}

function calculateRealRoute(origin, destination) {
  directionsService.route({
    origin: origin,
    destination: destination,
    travelMode: google.maps.TravelMode.DRIVING,
    provideRouteAlternatives: true
  }, (response, status) => {
    if (status === "OK") {
      directionsRenderer.setDirections(response);
      analyzeRouteAQI(response.routes[0], false);
    } else {
      alert("Directions request failed: " + status);
    }
  });
}

function calculateDemoRoute(origin, destination) {
  // Mock Route Data
  const mockRoute = {
    legs: [{
      distance: { text: "14.2 km" },
      duration: { text: "35 mins" }
    }]
  };

  // Mock AQI Analysis
  analyzeRouteAQI(mockRoute, true);
}

// --- AQI Logic ---

async function analyzeRouteAQI(route, isMock) {
  let avgAQI, healthScore;

  if (isMock) {
    // Generate random realistic stats for demo
    avgAQI = Math.floor(Math.random() * (160 - 40) + 40); // Random between 40 and 160
  } else {
    try {
      // Get destination coordinates from the route
      const leg = route.legs[0];
      const destinationLat = leg.end_location.lat();
      const destinationLng = leg.end_location.lng();

      console.log(`Fetching AQI for destination: ${destinationLat}, ${destinationLng}`);
      const aqiData = await fetchAQI(destinationLat, destinationLng);

      if (aqiData && aqiData.indexes && aqiData.indexes.length > 0) {
        // Google AQI is usually 0-100 or similar, but let's map it or use raw if it's standard US AQI
        // The API returns various indexes. Let's look for "universal_aqi" or similar, or just take the first one.
        // For simplicity in this hackathon context, we'll assume the first index's aqi score is usable.
        avgAQI = aqiData.indexes[0].aqi;
      } else {
        console.warn("No AQI data found in response, defaulting.");
        avgAQI = 85;
      }

    } catch (e) {
      console.error("Error fetching AQI:", e);
      avgAQI = 90; // Fallback
    }
  }

  updateRouteStats(route, avgAQI, isMock);
}

async function fetchAQI(lat, lng) {
  const url = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${CONFIG.GOOGLE_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      location: {
        latitude: lat,
        longitude: lng
      },
      extraComputations: ["HEALTH_RECOMMENDATIONS", "DOMINANT_POLLUTANT_CONCENTRATION", "POLLUTANT_CONCENTRATION", "LOCAL_AQI"]
    })
  });

  if (!response.ok) {
    throw new Error(`AQI API Error: ${response.statusText}`);
  }

  return await response.json();
}

function updateRouteStats(route, avgAQI, isMock) {
  const distance = route.legs[0].distance.text;
  const duration = route.legs[0].duration.text;
  const statsContainer = document.getElementById('route-stats');

  let healthScore = Math.max(0, Math.min(100, 100 - (avgAQI / 3)));
  healthScore = Math.round(healthScore);

  const color = getColorForAQI(avgAQI);
  const badge = isMock ? '<span class="ml-2 px-2 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-500 rounded border border-yellow-500/30">DEMO</span>' : '';

  const healthTip = getHealthTip(avgAQI);

  statsContainer.innerHTML = `
        <div class="flex items-baseline justify-between mb-4">
            <h3 class="text-lg font-semibold flex items-center">Analysis ${badge}</h3>
            <span class="text-xs text-gray-500 uppercase tracking-wider">Live Data</span>
        </div>

        <!-- Card 1 -->
        <div class="glass-card p-5 mb-4 border border-white/5">
            <div class="flex justify-between items-center mb-3">
                <span class="text-gray-400 text-sm font-medium">Health Score</span>
                <span class="text-white font-bold text-2xl" style="color: ${color}">${healthScore}</span>
            </div>
            <div class="w-full bg-white/10 rounded-full h-1.5">
                <div class="h-1.5 rounded-full transition-all duration-1000" style="width: ${healthScore}%; background-color: ${color}"></div>
            </div>
            <div class="mt-3 pt-3 border-t border-white/5 flex items-start gap-2">
                 <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p class="text-xs text-gray-400 leading-relaxed">${healthTip}</p>
            </div>
        </div>

        <!-- Details -->
        <div class="grid grid-cols-2 gap-4">
            <div class="glass-card p-4 text-center border border-white/5">
                <div class="text-xl font-bold text-white mb-1">${distance}</div>
                <div class="text-[10px] text-gray-500 uppercase tracking-wider">Distance</div>
            </div>
            <div class="glass-card p-4 text-center border border-white/5">
                <div class="text-xl font-bold text-white mb-1">${duration}</div>
                <div class="text-[10px] text-gray-500 uppercase tracking-wider">Time</div>
            </div>
        </div>
    `;
  statsContainer.classList.remove('hidden');
}

function getHealthTip(aqi) {
  if (aqi <= 50) return "Air quality is good. Perfect for walking or cycling.";
  if (aqi <= 100) return "Air quality is acceptable. Sensitive individuals should consider limiting prolonged outdoor exertion.";
  if (aqi <= 150) return "Members of sensitive groups may experience health effects. The general public is less likely to be affected.";
  return "Health alert: everyone may experience more serious health effects. Avoid outdoor activities.";
}

function getColorForAQI(aqi) {
  if (aqi <= 50) return '#10b981';
  if (aqi <= 100) return '#f59e0b';
  if (aqi <= 150) return '#f97316';
  return '#ef4444';
}

// --- Tab Switching Logic ---
function switchTab(tabName) {
  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });

  // Show selected tab content
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  // Find the button that was clicked (simple way based on text content or event, 
  // but here we can just find the one with the matching onclick for simplicity 
  // or pass 'this' in the onclick)
  // Actually, let's just re-select based on the onclick attribute to be safe without passing 'this'
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('onclick').includes(tabName)) {
      btn.classList.add('active');
    }
  });
}

// Start
if (window.google && window.google.maps) {
  initMap(); // Map loaded already?
} else {
  // Wait for load or init demo
  window.initMap = initMap; // Callback for Google Maps
  // If we are in demo mode (no key), we won't get the callback, so call initApp immediately
  if (isDemoMode) {
    initApp();
  }
}
