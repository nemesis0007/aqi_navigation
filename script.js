// Lightweight India-wide route + pollution navigation
let map;
let routeLayers = [];
let selectedRouteId = null;
let heatLayer = null;
// When deployed with a backend (Render/Cloud Run), enable batching/caching.
// Set to `true` for production deployments that provide `/api/exposure`.
const USE_BACKEND = true;

// Minimal map initialization and safe stubs to avoid runtime errors
function initMap() {
    try {
        if (map) return;
        map = L.map('map', { preferCanvas: true }).setView([22.5937, 78.9629], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
        L.control.scale({ position: 'bottomleft' }).addTo(map);
    } catch (e) {
        console.error('initMap error', e);
    }
}

function toggleHeatmap() {
    if (!map) return;
    if (heatLayer) { try { map.removeLayer(heatLayer); heatLayer = null; } catch (e) {} }
    else if (selectedRouteId !== null && routeLayers[selectedRouteId]) {
        // try to build heatmap for currently selected route; safe no-op if missing
        try { buildRouteHeatmap(routeLayers[selectedRouteId].meta.route); } catch (e) { console.warn('toggleHeatmap build failed', e); }
    } else {
        console.info('No heatmap data to show');
    }
}

function clearRoutes() {
    try {
        routeLayers.forEach(r => { try { map.removeLayer(r.layer); } catch (e) {} });
        routeLayers = [];
        selectedRouteId = null;
    } catch (e) { console.error('clearRoutes error', e); }
}

// Decode a polyline encoded string. Default precision 1e5 matches OSRM `polyline`.
// Use precision=1e6 for `polyline6` encoded geometries.
function decodePolyline(str, precision = 1e5) {
    const coords = [];
    let index = 0, lat = 0, lng = 0;
    while (index < str.length) {
        let shift = 0, result = 0, byte = null;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += deltaLat;

        shift = 0; result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        const deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += deltaLng;

        coords.push([lat / precision, lng / precision]);
    }
    return coords;
}

// Sample points along a coordinate array at approximately every `step` points.
function samplePoints(coords, step = 4) {
    if (!coords || coords.length === 0) return [];
    if (step <= 1) return coords.slice();
    const out = [];
    for (let i = 0; i < coords.length; i += step) out.push(coords[i]);
    if (coords.length > 0 && out[out.length-1] !== coords[coords.length-1]) out.push(coords[coords.length-1]);
    return out;
}

// Sample points by approximate distance interval (meters). Returns array of [lat,lon].
function samplePointsByDistance(coords, intervalMeters = 300) {
    if (!coords || coords.length < 2) return coords.slice();
    const out = [];
    let acc = 0;
    out.push(coords[0]);
    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i-1];
        const cur = coords[i];
        const d = haversine(prev[0], prev[1], cur[0], cur[1]);
        acc += d;
        if (acc >= intervalMeters) {
            out.push(cur);
            acc = 0;
        }
    }
    if (out.length === 0 || (out[out.length-1][0] !== coords[coords.length-1][0] || out[out.length-1][1] !== coords[coords.length-1][1])) {
        out.push(coords[coords.length-1]);
    }
    return out;
}

// Lightweight route fetcher using OSRM public API
async function fetchRoutes(from, to) {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?alternatives=true&overview=full&geometries=polyline`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('OSRM error');
        const json = await res.json();
        return json.routes || [];
    } catch (e) {
        console.error('fetchRoutes error', e);
        return [];
    }
}


// Placeholder exposure calculation: returns a simple score based on distance
async function computeRouteExposure(route) {
    try {
        // route.distance is meters; normalize to an arbitrary exposure metric
        const exposure = (route.distance || 0) / 1000.0; // km as proxy
        return { exposure, distance: route.distance || 0 };
    } catch (e) { return { exposure: Infinity, distance: 0 }; }
}

// Geocode using Nominatim (returns array of { display_name, lat, lon })
async function geocode(q, limit = 6) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=${limit}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        if (!res.ok) return [];
        const json = await res.json();
        return (json || []).map(it => ({ display_name: it.display_name, lat: parseFloat(it.lat), lon: parseFloat(it.lon) }));
    } catch (e) {
        console.error('geocode error', e);
        return [];
    }
}

// ------------------------
// AQI provider + caching
// ------------------------
// Grid rounding for cache keys: ~0.03° (~3 km). Tune within 0.02-0.05°.
const AQI_CACHE_GRID = 0.03;
const AQI_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const AQI_ALPHA_NO2 = 0.1; // weight for NO2 in exposure metric
const AQI_FETCH_TIMEOUT_MS = 5000;
const aqiCache = new Map();

function aqiCacheKey(lat, lon) {
    const rlat = Math.round(lat / AQI_CACHE_GRID) * AQI_CACHE_GRID;
    const rlon = Math.round(lon / AQI_CACHE_GRID) * AQI_CACHE_GRID;
    return `${rlat.toFixed(5)}_${rlon.toFixed(5)}`;
}

async function fetchOpenMeteoAQ(lat, lon) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), AQI_FETCH_TIMEOUT_MS);
    try {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5,nitrogen_dioxide`;
        const resp = await fetch(url, { signal: ac.signal });
        if (!resp.ok) throw new Error('OpenMeteo response ' + resp.status);
        const j = await resp.json();
        // pick latest hourly values if present
        const timeIndex = (j.hourly && j.hourly.time && j.hourly.time.length) ? j.hourly.time.length - 1 : null;
        const pm = (timeIndex !== null && j.hourly.pm2_5 && j.hourly.pm2_5[timeIndex] != null) ? j.hourly.pm2_5[timeIndex] : null;
        const no2 = (timeIndex !== null && j.hourly.nitrogen_dioxide && j.hourly.nitrogen_dioxide[timeIndex] != null) ? j.hourly.nitrogen_dioxide[timeIndex] : null;
        clearTimeout(timeout);
        if (pm == null && no2 == null) return null;
        return { pm2_5: typeof pm === 'number' ? pm : null, no2: typeof no2 === 'number' ? no2 : null };
    } catch (e) {
        clearTimeout(timeout);
        console.warn('fetchOpenMeteoAQ failed', e && e.message);
        return null;
    }
}

// Provider-agnostic AQI getter. Tries cache, then primary provider, then fallback.
async function getAirQuality(lat, lon) {
    const key = aqiCacheKey(lat, lon);
    const now = Date.now();
    const cached = aqiCache.get(key);
    if (cached && (now - cached.ts) < AQI_CACHE_TTL_MS) return cached.val;

    // primary provider: Open-Meteo
    let val = await fetchOpenMeteoAQ(lat, lon);
    // fallback: try CPCB stub (not implemented) — skip and return null for now
    if (!val) {
        // Do not assume zeros — return null to signal missing data
        aqiCache.set(key, { val: null, ts: now });
        return null;
    }

    aqiCache.set(key, { val, ts: now });
    return val;
}

// ------------------------
// Utilities
// ------------------------
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*toRad) * Math.cos(lat2*toRad) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function ensureNumber(v) { return (typeof v === 'number' && !isNaN(v)) ? v : null; }

// ------------------------
// Exposure calculation
// ------------------------
// Compute exposure for a route. Returns object { exposure, exposurePerHour, validSamples, totalSamples, confidence }
async function computeRouteExposure(route) {
    try {
        if (!route || !route.geometry || !ensureNumber(route.distance) || !ensureNumber(route.duration)) {
            return { exposure: null, exposurePerHour: null, validSamples: 0, totalSamples: 0, confidence: 'low' };
        }

        const coords = decodePolyline(route.geometry); // [[lat,lon], ...]
        if (!coords || coords.length < 2) return { exposure: null, exposurePerHour: null, validSamples: 0, totalSamples: 0, confidence: 'low' };

        // choose sampling interval by route length (meters)
        const totalDist = route.distance; // meters
        const interval = (totalDist > 20000) ? 25000 : 300; // inter-city vs city

        const sampled = samplePointsByDistance(coords, interval);
        const totalSamples = sampled.length;

        // build per-segment distances between sampled points
        const segDists = [];
        for (let i = 1; i < sampled.length; i++) {
            segDists.push(haversine(sampled[i-1][0], sampled[i-1][1], sampled[i][0], sampled[i][1]));
        }
        // if no segments (single point), fallback to tiny sample
        if (segDists.length === 0) return { exposure: null, exposurePerHour: null, validSamples: 0, totalSamples, confidence: 'low' };

        // compute time per meter factor
        const timePerMeter = route.duration / Math.max(1, totalDist);

        let cumulativeExposure = 0;
        let validSamples = 0;

        // Build midpoints list for segments
        const midpoints = [];
        for (let i = 0; i < segDists.length; i++) {
            const a = sampled[i];
            const b = sampled[i+1];
            const midLat = (a[0] + b[0]) / 2.0;
            const midLon = (a[1] + b[1]) / 2.0;
            midpoints.push({ lat: midLat, lon: midLon });
        }

        // Fetch pollutant values in batch when backend helper is enabled to reduce many small requests.
        let polls = [];
        if (USE_BACKEND) {
            try {
                const resp = await fetch('/api/exposure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points: midpoints }) });
                if (resp.ok) {
                    const json = await resp.json();
                    polls = (json.points || []).map(p => ({ pm2_5: p.pm2_5, no2: p.no2 }));
                } else {
                    polls = await Promise.all(midpoints.map(m => getAirQuality(m.lat, m.lon).catch(() => null)));
                }
            } catch (e) {
                console.warn('Backend exposure batch failed', e && e.message);
                polls = await Promise.all(midpoints.map(m => getAirQuality(m.lat, m.lon).catch(() => null)));
            }
        } else {
            // client-side fetching (uses cache and provider-agnostic getter)
            polls = await Promise.all(midpoints.map(m => getAirQuality(m.lat, m.lon).catch(() => null)));
        }

        // aggregate exposures from polls
        for (let i = 0; i < segDists.length; i++) {
            const aq = polls[i];
            if (!aq || (aq.pm2_5 == null && aq.no2 == null)) continue;
            const pm = ensureNumber(aq.pm2_5) || 0;
            const no2 = ensureNumber(aq.no2) || 0;
            const conc = pm + AQI_ALPHA_NO2 * no2;
            const segTime = segDists[i] * timePerMeter; // seconds
            cumulativeExposure += conc * segTime;
            validSamples++;
        }

        if (validSamples === 0) {
            return { exposure: null, exposurePerHour: null, validSamples, totalSamples, confidence: 'low' };
        }

        // exposure per hour (normalize by time)
        const exposurePerSecond = cumulativeExposure / Math.max(1, route.duration);
        const exposurePerHour = exposurePerSecond * 3600;
        // return raw cumulative and per-hour metric
        const confidence = (validSamples < 3) ? 'low' : 'high';
        return { exposure: cumulativeExposure, exposurePerHour, validSamples, totalSamples, confidence };
    } catch (e) {
        console.error('computeRouteExposure error', e && e.message);
        return { exposure: null, exposurePerHour: null, validSamples: 0, totalSamples: 0, confidence: 'low' };
    }
}
// Build a focused heatmap along a single route (called when a route is selected).
// This avoids broad map sampling and reduces API usage. The function samples
// the decoded route polyline, fetches pollutant values for points, and renders
// a heat layer along the route only.
async function buildRouteHeatmap(route) {
    if (!map || !route) return;
    if (heatLayer) try { map.removeLayer(heatLayer); } catch (e) {}
    try {
        const coords = decodePolyline(route.geometry);
        const sampled = samplePoints(coords, 4);
        let polls = [];
        if (USE_BACKEND) {
            try {
                const points = sampled.map(p => ({ lat: p[0], lon: p[1] }));
                const resp = await fetch('/api/exposure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points }) });
                const json = await resp.json();
                polls = (json.points || []).map(p => ({ pm2_5: p.pm2_5, no2: p.no2 }));
                } catch (e) {
                        polls = await Promise.all(sampled.map(p => getAirQuality(p[0], p[1]).catch(() => null)));
                    }
        } else {
                polls = await Promise.all(sampled.map(p => getAirQuality(p[0], p[1]).catch(() => null)));
        }
        const points = sampled.map((p, i) => {
            const pm = (polls[i] && typeof polls[i].pm2_5 === 'number') ? polls[i].pm2_5 : null;
            const intensity = (typeof pm === 'number') ? Math.min(1, Math.sqrt(pm / 150)) : 0.05;
            return [p[0], p[1], intensity];
        });
        const zoom = map.getZoom() || 12;
        const radius = Math.max(6, Math.round(24 - zoom * 0.5));
        heatLayer = L.heatLayer(points, { radius, blur: Math.round(radius * 0.8), max: 1, gradient: {0.0: 'blue', 0.25: 'cyan', 0.5: 'lime', 0.75: 'orange', 1.0: 'red'} }).addTo(map);
    } catch (e) { console.error('Route heatmap error', e); }
}

async function renderAndScoreRoutes(osmRoutes) {
    clearRoutes();
    const routeListEl = document.getElementById('route-list');
    routeListEl.innerHTML = '';

    // Add short disclaimer about exposure values
    const disc = document.createElement('div');
    disc.className = 'text-xs text-gray-400 mb-2';
    disc.textContent = 'Exposure values are relative estimates for comparison (not medical advice).';
    routeListEl.appendChild(disc);

    const scored = await Promise.all(osmRoutes.map(async (r, idx) => {
        const score = await computeRouteExposure(r).catch(() => ({ exposure: null, exposurePerHour: null, validSamples: 0, totalSamples: 0, confidence: 'low' }));
        return { route: r, idx, ...score };
    }));

    // Determine healthiest (min exposurePerHour among valid) and fastest (min duration)
    const validExposures = scored.filter(s => s.exposurePerHour != null).map(s => s.exposurePerHour);
    let minExposure = validExposures.length ? Math.min(...validExposures) : null;
    if (minExposure === 0) minExposure = 1e-6; // avoid division by zero
    const healthiest = (minExposure != null) ? scored.filter(s => s.exposurePerHour === minExposure)[0] || scored.reduce((a,b) => ( (a.exposurePerHour||Infinity) < (b.exposurePerHour||Infinity) ? a : b ), scored[0]) : null;
    const fastest = scored.reduce((a,b) => (b.route.duration < a.route.duration ? b : a), scored[0] || null);

    // compute relative differences and render
    scored.forEach((s) => {
        const coords = decodePolyline(s.route.geometry).map(p => [p[0], p[1]]);
        const isHealthiest = (s === healthiest);
        const isFastest = (s === fastest);
        const color = isHealthiest ? '#34C759' : (isFastest ? '#007AFF' : '#777');
        const weight = (isHealthiest || isFastest) ? 5 : 3;
        const layer = L.polyline(coords, { color, weight, opacity: 0.9 }).addTo(map);
        const bounds = layer.getBounds();

        // relative exposure
        let relText = 'Exposure: unavailable';
        if (s.exposurePerHour != null && minExposure != null) {
            const pct = Math.round(((s.exposurePerHour - minExposure) / minExposure) * 100);
            if (isHealthiest) relText = 'Healthiest (reference)';
            else relText = `${Math.abs(pct)}% higher exposure vs healthiest`;
        }

        const confidenceText = (s.confidence === 'low') ? ' • estimated / low confidence' : '';

        const item = document.createElement('div');
        item.className = 'route-item p-3 rounded-md bg-white/3 cursor-pointer';
        item.style.borderLeft = `4px solid ${color}`;
        const durMin = Math.round(s.route.duration / 60);
        const distKm = (s.route.distance/1000).toFixed(1);
        item.innerHTML = `<div class="text-sm font-medium">Route ${s.idx+1} ${isHealthiest?'<span class="text-xs bg-green-600/20 ml-2 px-2 py-0.5 rounded">Healthiest</span>':''} ${isFastest?'<span class="text-xs bg-blue-600/20 ml-2 px-2 py-0.5 rounded">Fastest</span>':''}</div>
                          <div class="text-xs text-gray-300">${durMin} min • ${distKm} km • ${relText}${confidenceText}</div>`;

        item.onclick = () => {
            selectedRouteId = s.idx;
            routeLayers.forEach(rly => rly.layer.setStyle({ opacity: 0.6 }));
            layer.setStyle({ opacity: 1.0, weight: 6 });
            map.fitBounds(bounds.pad(0.15));
            // Build focused heatmap for this route only
            buildRouteHeatmap(s.route);
        };

        routeListEl.appendChild(item);
        routeLayers.push({ idx: s.idx, layer, meta: s });
    });

    // auto-select by preference
    const pref = document.querySelector('.pref-btn.active')?.id || 'pref-fastest';
    let toSelect = null;
    if (pref === 'pref-healthiest' && healthiest) toSelect = healthiest.idx;
    else if (fastest) toSelect = fastest.idx;
    if (toSelect !== null) {
        const entry = routeLayers.find(r => r.idx === toSelect);
        if (entry) {
            selectedRouteId = toSelect;
            entry.layer.setStyle({ weight: 6, opacity: 1.0 });
            map.fitBounds(entry.layer.getBounds().pad(0.15));
            // build heatmap for the auto-selected route
            buildRouteHeatmap(entry.meta.route);
        }
    }
}

// UI wiring
function initPanelLogic() {
    const findBtn = document.getElementById('find-routes');
    const startInput = document.getElementById('start-input');
    const endInput = document.getElementById('end-input');
    const startClear = document.getElementById('start-clear');
    const endClear = document.getElementById('end-clear');
    const spinner = document.getElementById('find-spinner');
    const geoBtn = document.getElementById('geolocate-btn');
    const prefFast = document.getElementById('pref-fastest');
    const prefHealth = document.getElementById('pref-healthiest');

    prefFast.onclick = () => { prefFast.classList.add('active'); prefHealth.classList.remove('active'); };
    prefHealth.onclick = () => { prefHealth.classList.add('active'); prefFast.classList.remove('active'); };

    // Clear buttons
    if (startClear) startClear.onclick = () => { startInput.value = ''; delete startInput.dataset.lat; delete startInput.dataset.lon; };
    if (endClear) endClear.onclick = () => { endInput.value = ''; delete endInput.dataset.lat; delete endInput.dataset.lon; };

    geoBtn.onclick = async () => {
        if (!navigator.geolocation) return alert('Geolocation not available');
        navigator.geolocation.getCurrentPosition((pos) => {
            startInput.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
            startInput.dataset.lat = pos.coords.latitude.toFixed(6);
            startInput.dataset.lon = pos.coords.longitude.toFixed(6);
        }, (err) => alert('Geolocation failed'));
    };

    findBtn.onclick = async () => {
        findBtn.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';
        try {
            const startVal = startInput.value.trim();
            const endVal = endInput.value.trim();
            if (!startVal || !endVal) return alert('Enter both start and destination');

            // parse lat,lng quick form or geocode
            const parseLatLng = (v) => {
                const m = v.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
                if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
                return null;
            };

            let from = parseLatLng(startVal);
            // prefer exact selection (data attributes set by autocomplete)
            if (!from && startInput.dataset && startInput.dataset.lat && startInput.dataset.lon) {
                from = { lat: parseFloat(startInput.dataset.lat), lon: parseFloat(startInput.dataset.lon) };
            }
            if (!from) {
                const res = await geocode(startVal);
                if (!res.length) throw new Error('Start not found');
                from = { lat: res[0].lat, lon: res[0].lon };
            }

            let to = parseLatLng(endVal);
            if (!to && endInput.dataset && endInput.dataset.lat && endInput.dataset.lon) {
                to = { lat: parseFloat(endInput.dataset.lat), lon: parseFloat(endInput.dataset.lon) };
            }
            if (!to) {
                const res = await geocode(endVal);
                if (!res.length) throw new Error('Destination not found');
                to = { lat: res[0].lat, lon: res[0].lon };
            }

            const routes = await fetchRoutes(from, to);
            if (!routes || routes.length === 0) throw new Error('No routes found');
            await renderAndScoreRoutes(routes);
        } catch (e) {
            console.error(e);
            alert('Route planning failed: ' + (e.message || e));
        } finally { findBtn.disabled = false; }
    };

    // hide spinner when find finishes (also ensure spinner hidden on errors)
    document.addEventListener('click', () => { if (spinner) spinner.style.display = 'none'; });

    // Pressing Enter in either input triggers the find button
    [startInput, endInput].forEach(inp => {
        inp.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                findBtn.click();
            }
        });
    });

    // initialize autocomplete after panel elements are wired
    try { initAutocomplete(); } catch (e) { console.warn('initAutocomplete failed', e); }
}

window.onload = () => {
    initMap();
    initPanelLogic();
};

// --- Autocomplete with inline typeahead ---
function createAutocomplete(inputEl) {
    if (!inputEl) return;
    const parent = inputEl.parentElement;
    if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    const list = document.createElement('div');
    list.className = 'autocomplete-list';
    list.style.display = 'none';
    parent.appendChild(list);

    let items = [];
    let active = -1;
    let debounce;

    inputEl.addEventListener('input', () => {
        const q = inputEl.value;
        delete inputEl.dataset.lat; delete inputEl.dataset.lon;
        active = -1;
        if (debounce) clearTimeout(debounce);
        if (!q || q.trim().length === 0) { list.innerHTML = ''; list.style.display = 'none'; return; }
        debounce = setTimeout(async () => {
            list.style.display = 'block';
            list.innerHTML = '<div class="autocomplete-item loading">Searching…</div>';
            try {
                items = await geocode(q);
                if (!items || items.length === 0) {
                    list.innerHTML = '<div class="autocomplete-item empty">No results</div>';
                    return;
                }
                list.innerHTML = '';
                items.forEach((it, idx) => {
                    const el = document.createElement('div');
                    el.className = 'autocomplete-item';
                    el.tabIndex = 0;
                    el.textContent = it.display_name;
                    // pointerdown ensures selection before blur; onclick preserved for compatibility
                    el.addEventListener('pointerdown', (e) => { e.preventDefault(); select(idx); });
                    el.onclick = () => select(idx);
                    el.onkeydown = (ev) => { if (ev.key === 'Enter') select(idx); };
                    list.appendChild(el);
                });

                // inline suggestion: if first suggestion begins with typed text, show completion
                const first = items[0];
                if (first && first.display_name) {
                    const typed = q;
                    const disp = first.display_name;
                    if (disp.toLowerCase().startsWith(typed.toLowerCase())) {
                        inputEl.value = disp;
                        try { inputEl.setSelectionRange(typed.length, disp.length); } catch (e) {}
                    }
                }
            } catch (e) {
                list.innerHTML = '<div class="autocomplete-item error">Error</div>';
            }
        }, 260);
    });

    inputEl.addEventListener('keydown', (ev) => {
        const children = list.querySelectorAll('.autocomplete-item');
        if (ev.key === 'Tab' || ev.key === 'ArrowRight') {
            if (items && items.length > 0) {
                ev.preventDefault();
                select(0);
                return;
            }
            return;
        }
        if (!children.length) return;
        if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(active + 1, children.length - 1); updateActive(children); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(active - 1, 0); updateActive(children); }
        else if (ev.key === 'Enter') { if (active >= 0) { ev.preventDefault(); select(active); } }
        else if (ev.key === 'Escape') { list.innerHTML = ''; list.style.display = 'none'; active = -1; }
    });

    function updateActive(children) {
        children.forEach((c, i) => c.classList.toggle('active', i === active));
        if (active >= 0) children[active].scrollIntoView({ block: 'nearest' });
    }

    function select(idx) {
        const it = items[idx];
        if (!it) return;
        inputEl.value = it.display_name;
        inputEl.dataset.lat = it.lat;
        inputEl.dataset.lon = it.lon;
        list.innerHTML = '';
        list.style.display = 'none';
        active = -1;
        inputEl.focus();
        // place caret at end
        try { inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length); } catch(e) {}
    }

    document.addEventListener('click', (e) => {
        if (!list.contains(e.target) && e.target !== inputEl) {
            list.innerHTML = '';
            list.style.display = 'none';
            active = -1;
        }
    });
}

function initAutocomplete() {
    createAutocomplete(document.getElementById('start-input'));
    createAutocomplete(document.getElementById('end-input'));
}

// initAutocomplete is invoked from initPanelLogic()