// Lightweight India-wide route + pollution navigation
let map;
let routeLayers = [];
let selectedRouteId = null;

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const OPEN_METEO_AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

// Toggle to use the optional backend batch endpoint (false by default).
// If you set this to true, the frontend will POST sampled points to
// `/api/exposure` to reduce parallel client-side requests. For hackathon
// simplicity this is off; the frontend uses Open-Meteo directly.
const USE_BACKEND = false;

function initMap() {
    // Default view: India (not Pune-centric)
    map = L.map('map', { zoomControl: true }).setView([22.0, 78.0], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

// Simple Nominatim geocode
async function geocode(q) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`;
    const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.map(d => ({ lat: parseFloat(d.lat), lon: parseFloat(d.lon), display_name: d.display_name }));
}

// OSRM routing with alternatives
async function fetchRoutes(from, to) {
    const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
    const url = `${OSRM_URL}/${coords}?alternatives=true&overview=full&geometries=polyline&steps=false&annotations=distance,duration`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Routing failed');
    const json = await resp.json();
    return json.routes || [];
}

// Polyline decode (Google encoded polyline)
function decodePolyline(encoded) {
    let index = 0, lat = 0, lng = 0, coordinates = [];
    const shiftAnd = () => {
        let result = 0, shift = 0, b;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        return ((result & 1) ? ~(result >> 1) : (result >> 1));
    };
    while (index < encoded.length) {
        lat += shiftAnd();
        lng += shiftAnd();
        coordinates.push([lat / 1e5, lng / 1e5]);
    }
    return coordinates;
}

// Haversine distance (meters)
function haversineDistance(a, b) {
    const toRad = v => v * Math.PI / 180;
    const R = 6371000;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const sinDlat = Math.sin(dLat/2), sinDlon = Math.sin(dLon/2);
    const aVal = sinDlat*sinDlat + Math.cos(lat1)*Math.cos(lat2)*sinDlon*sinDlon;
    const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1-aVal));
    return R * c;
}

// Sample points along polyline: pick every Nth point to limit API calls
function samplePoints(points, step = 8) {
    const sampled = [];
    for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
    if (sampled.length === 0 && points.length) sampled.push(points[0]);
    // Ensure last point is included (compare values, not references)
    if (points.length) {
        const lastSample = sampled[sampled.length-1];
        const lastPoint = points[points.length-1];
        const lastSampleStr = lastSample ? `${lastSample[0]},${lastSample[1]}` : null;
        const lastPointStr = `${lastPoint[0]},${lastPoint[1]}`;
        if (lastSampleStr !== lastPointStr) sampled.push(lastPoint);
    }
    return sampled;
}

// Fetch pollution at a point using Open-Meteo Air Quality API
async function fetchPollution(lat, lon) {
    const url = `${OPEN_METEO_AQ_URL}?latitude=${lat}&longitude=${lon}&hourly=pm2_5,nitrogen_dioxide&timezone=UTC`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const json = await resp.json();
        // take first available hourly value
        const pm = json && json.hourly && json.hourly.pm2_5 && json.hourly.pm2_5.length ? json.hourly.pm2_5[0] : null;
        const no2 = json && json.hourly && json.hourly.nitrogen_dioxide && json.hourly.nitrogen_dioxide.length ? json.hourly.nitrogen_dioxide[0] : null;
        return { pm2_5: pm, no2 };
    } catch (e) { return null; }
}

// Compute exposure score for a route: weighted (pm2.5 + 0.1*no2) * distance
async function computeRouteExposure(route) {
    const coords = decodePolyline(route.geometry);
    const sampled = samplePoints(coords, 8);
    // fetch pollution for sampled points (limit concurrency). We either
    // call the backend batch endpoint or fetch per-point directly from
    // Open-Meteo depending on configuration.
    let polls = [];
    if (USE_BACKEND) {
        try {
            const points = sampled.map(p => ({ lat: p[0], lon: p[1] }));
            const resp = await fetch('/api/exposure', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points })
            });
            const json = await resp.json();
            polls = (json.points || []).map(p => ({ pm2_5: p.pm2_5, no2: p.no2 }));
        } catch (e) {
            polls = await Promise.all(sampled.map(p => fetchPollution(p[0], p[1]).catch(() => null)));
        }
    } else {
        polls = await Promise.all(sampled.map(p => fetchPollution(p[0], p[1]).catch(() => null)));
    }
    // associate pollutants to segments between sampled points
    let exposureSum = 0;
    let distanceSum = 0;
    for (let i = 0; i < sampled.length - 1; i++) {
        const a = sampled[i];
        const b = sampled[i+1];
        const dist = haversineDistance(a, b); // meters
        const p1 = polls[i] || { pm2_5: 0, no2: 0 };
        const p2 = polls[i+1] || { pm2_5: 0, no2: 0 };
        const avgPm = ((p1.pm2_5 || 0) + (p2.pm2_5 || 0)) / 2;
        const avgNo2 = ((p1.no2 || 0) + (p2.no2 || 0)) / 2;
        const pollutantScore = avgPm + 0.1 * (avgNo2 || 0);
        exposureSum += pollutantScore * dist;
        distanceSum += dist;
    }
    // fallback: if no segments (very short), use single point
    if (distanceSum === 0 && sampled.length && polls.length) {
        const p = polls[0] || { pm2_5: 0, no2: 0 };
        return { exposure: (p.pm2_5 || 0) + 0.1*(p.no2||0), distance: 0 };
    }
    const exposurePerMeter = distanceSum > 0 ? (exposureSum / distanceSum) : Infinity;
    return { exposure: exposurePerMeter, exposureSum, distance: distanceSum };
}

// Clear existing route layers
function clearRoutes() {
    for (const l of routeLayers) {
        try { map.removeLayer(l.layer); } catch(e){}
    }
    routeLayers = [];
}

// Render routes (array of OSRM route objects) and add list entries
async function renderAndScoreRoutes(osmRoutes) {
    clearRoutes();
    const routeListEl = document.getElementById('route-list');
    routeListEl.innerHTML = '';

    // compute exposures in parallel (but limited by browser). For simplicity use Promise.all.
    const scored = await Promise.all(osmRoutes.map(async (r, idx) => {
        const score = await computeRouteExposure(r).catch(() => ({ exposure: Infinity, distance: 0 }));
        return { route: r, idx, ...score };
    }));

    // Determine healthiest and fastest
    const healthiest = scored.reduce((a,b) => (b.exposure < a.exposure ? b : a), scored[0] || null);
    const fastest = scored.reduce((a,b) => (b.route.duration < a.route.duration ? b : a), scored[0] || null);

    scored.forEach((s) => {
        const coords = decodePolyline(s.route.geometry).map(p => [p[0], p[1]]);
        const color = (s === healthiest) ? '#34C759' : (s === fastest ? '#007AFF' : '#777');
        const weight = (s === healthiest || s === fastest) ? 5 : 3;
        const layer = L.polyline(coords, { color, weight, opacity: 0.9 }).addTo(map);
        const bounds = layer.getBounds();

        const item = document.createElement('div');
        item.className = 'route-item p-3 rounded-md bg-white/3 cursor-pointer';
        item.style.borderLeft = `4px solid ${color}`;
        const durMin = Math.round(s.route.duration / 60);
        const distKm = (s.route.distance/1000).toFixed(1);
        const exposureVal = isFinite(s.exposure) ? s.exposure.toFixed(2) : '—';
        item.innerHTML = `<div class="text-sm font-medium">Route ${s.idx+1}</div>
                          <div class="text-xs text-gray-300">${durMin} min • ${distKm} km • exposure ${exposureVal}</div>`;
        item.onclick = () => {
            // highlight selected
            selectedRouteId = s.idx;
            routeLayers.forEach(rly => rly.layer.setStyle({ opacity: 0.6 }));
            layer.setStyle({ opacity: 1.0, weight: 6 });
            map.fitBounds(bounds.pad(0.15));
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

// ensure initAutocomplete runs when page loads
window.addEventListener('load', () => { try { initAutocomplete(); } catch(e){} });