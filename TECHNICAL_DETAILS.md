# AQI Navigation - Technical Documentation

## 📋 Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Frontend Implementation](#frontend-implementation)
5. [Backend Implementation](#backend-implementation)
6. [APIs & Integrations](#apis--integrations)
7. [Data Flow](#data-flow)
8. [Deployment](#deployment)
9. [Performance Considerations](#performance-considerations)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    User Browser (GitHub Codespaces)         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           React Frontend (Vite)                      │   │
│  │  - Route Planning UI                                │   │
│  │  - Address Autocomplete                             │   │
│  │  - Map Visualization (Leaflet)                      │   │
│  │  Port: 5173                                         │   │
│  └─────────────────────┬──────────────────────────────┘   │
└────────────────────────┼─────────────────────────────────────┘
                         │ HTTP Requests
                         ▼
      ┌──────────────────────────────────────┐
      │     External APIs (Public)           │
      │  ┌─────────────────────────────────┐ │
      │  │ OSRM Routing Engine             │ │
      │  │ (Route calculation)             │ │
      │  │ https://router.project-osrm.org │ │
      │  └─────────────────────────────────┘ │
      │  ┌─────────────────────────────────┐ │
      │  │ Nominatim (Address Search)      │ │
      │  │ https://nominatim.openstreetmap │ │
      │  └─────────────────────────────────┘ │
      │  ┌─────────────────────────────────┐ │
      │  │ Open-Meteo (AQI Data)           │ │
      │  │ https://air-quality-api.open... │ │
      │  └─────────────────────────────────┘ │
      └──────────────────────────────────────┘
                         △
                         │
                    HTTP Bridge
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Flask Backend (Python)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │   /api/exposure Endpoint                            │  │
│  │   - Fetches AQI data from Open-Meteo               │  │
│  │   - Caches results (3km grid, 6-hour TTL)          │  │
│  │   - Calculates average PM2.5 & NO2                 │  │
│  │   Port: 5000                                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### **Frontend**
| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.2.0 | UI Framework - Component-based interface |
| Vite | 7.2.4 | Build tool - Fast HMR, optimized bundling |
| Leaflet | 1.9.4 | Map library - Interactive map visualization |
| Tailwind CSS | Latest | Utility-first CSS framework |
| JavaScript ES6+ | Latest | Modern JS with async/await support |

### **Backend**
| Technology | Version | Purpose |
|-----------|---------|---------|
| Python | 3.x | Backend runtime |
| Flask | Latest | Lightweight web framework |
| flask-cors | Latest | Cross-Origin Resource Sharing support |
| requests | Latest | HTTP client for external APIs |
| gunicorn | Latest | Production WSGI server |

### **External Services** (All Free/Open-Source)
| Service | Purpose | No Auth |
|---------|---------|---------|
| OSRM | Route calculation between points | ✅ Yes |
| Nominatim | Address geocoding & reverse geocoding | ✅ Yes |
| Open-Meteo | Real-time air quality (PM2.5, NO2) | ✅ Yes |
| OpenStreetMap | Base map tiles | ✅ Yes |

---

## Project Structure

```
aqi_navigation/
├── frontend/                  # Legacy frontend folder (not used)
│   └── ...
├── backend/                   # Python Flask backend
│   ├── main.py               # Main Flask application
│   ├── requirements.txt       # Python dependencies
│   ├── Procfile              # Deployment configuration
│   └── dockerfile            # Docker configuration
├── public/                    # Static assets
│   ├── index.html            # Legacy HTML (not used)
│   ├── styles.css            # Custom CSS (glassmorphism)
│   ├── main.js               # Legacy JS (not used)
│   └── vite.svg              # Asset
├── src/                       # React source code
│   ├── App.jsx               # Main React component (700+ lines)
│   ├── App.css               # App-specific styles
│   ├── styles.css            # Global styles (copied from public)
│   ├── main.jsx              # React entry point
│   ├── index.css             # Base CSS
│   └── assets/               # Images/SVGs
├── index.html                # Vite entry point (HTML root)
├── vite.config.js            # Vite configuration
├── package.json              # Frontend dependencies & scripts
├── eslint.config.js          # ESLint configuration
└── TECHNICAL_DETAILS.md      # This file
```

---

## Frontend Implementation

### **Core Component: App.jsx (700+ lines)**

#### **State Management**
```javascript
const [startInput, setStartInput]               // User start location
const [endInput, setEndInput]                   // User destination
const [preference, setPreference]               // 'fastest' or 'healthiest'
const [routes, setRoutes]                       // Array of calculated routes
const [selectedRoute, setSelectedRoute]         // Currently selected route ID
const [loading, setLoading]                     // Loading state for async ops
const [startSuggestions, setStartSuggestions]   // Autocomplete suggestions
const [endSuggestions, setEndSuggestions]       // Autocomplete suggestions
```

#### **Key Functions**

##### 1. **Map Initialization**
```javascript
initMap() {
  // Creates Leaflet map instance
  // Sets default view to India center (22.5937, 78.9629)
  // Adds OSM tile layer
  // Adds scale control
}
```

##### 2. **Geocoding (Address Search)**
```javascript
geocodeAddress(query) → Promise
// Calls Nominatim API
// Returns: [{ name, lat, lon }, ...]
// Filters results to India (countrycodes=in)
```

##### 3. **Route Finding**
```javascript
findRoutes() {
  1. Parse coordinates from user input (regex: /(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/)
  2. Validate coordinates
  3. Call OSRM API with alternatives=true
  4. Decode polyline geometry (Google's algorithm)
  5. Extract: distance, duration, coordinates
  6. Fetch AQI data for sampled points on route
  7. Display routes on map
  8. Sort/display in sidebar
}
```

##### 4. **Polyline Decoding**
```javascript
decodePolyline(str, precision = 1e5) → Array<[lat, lon]>
// Implements Google's polyline encoding algorithm
// Default precision: 1e5 (5 decimal places)
// Converts encoded string → array of coordinates
```

##### 5. **AQI Data Fetching**
```javascript
fetchAQIForRoutes(routeList) {
  1. Sample points along each route (max 15 points)
  2. Send POST request to /api/exposure
  3. Receive: avg_pm2_5, avg_no2, per-point data
  4. Update route objects with AQI values
  5. Color-code routes by pollution level
}
```

##### 6. **Route Visualization**
```javascript
// Routes displayed as L.polyline on Leaflet map
// Colors:
//   Route 0: #007AFF (Blue)
//   Route 1: #34C759 (Green)
//   Route 2+: #8B5CF6 (Purple)
// Weight: 3px opacity 0.7
// On select: weight 4px, opacity 1.0
```

#### **Styling**
- **Framework**: Tailwind CSS (CDN)
- **Custom Classes**: Glassmorphism effects from `styles.css`
- **Color Scheme**: Dark theme (Black background, white text)
- **AQI Indicators**:
  - `text-green-400`: PM2.5 < 50 µg/m³
  - `text-yellow-400`: PM2.5 50-100 µg/m³
  - `text-orange-400`: PM2.5 100-150 µg/m³
  - `text-red-400`: PM2.5 > 150 µg/m³

---

## Backend Implementation

### **Flask Application: main.py**

#### **Entry Point**
```python
app = Flask(__name__)
CORS(app)  # Enable cross-origin requests
```

#### **Environment Detection**
- Runs on `http://127.0.0.1:5000`
- In Codespaces: accessible at `https://{codespace-name}-5000.app.github.dev`

#### **AQI Cache System**
```python
AQI_CACHE = {}
AQI_CACHE_GRID = 0.03      # ~3km grid cells
AQI_CACHE_TTL = 6 * 3600   # 6 hours

_cache_key(lat, lon):
  # Rounds coordinates to grid
  # Example: 12.9716, 77.5946 → grid cell key
  # Reduces API calls for nearby coordinates
```

#### **API Endpoint: `/api/exposure`**

**Request Format (POST)**
```json
{
  "points": [
    {"lat": 12.9716, "lon": 77.5946},
    {"lat": 12.9720, "lon": 77.5950},
    ...
  ]
}
```

**Response Format**
```json
{
  "points": [
    {"pm2_5": 45.2, "no2": 12.5},
    {"pm2_5": 48.1, "no2": 13.2},
    ...
  ],
  "avg_pm2_5": 46.5,
  "avg_no2": 12.8
}
```

#### **Data Pipeline**
```
User Route → Sample 15 points → Send to /api/exposure
                                      ↓
                            Check cache (3km grid, 6hr)
                                      ↓
                            Miss? Call Open-Meteo API
                                      ↓
                            Cache result
                                      ↓
                            Return PM2.5, NO2 averages
```

#### **Open-Meteo Integration**
```python
fetch_open_meteo(lat, lon):
  URL: https://air-quality-api.open-meteo.com/v1/air-quality
  Params: latitude, longitude, hourly=pm2_5,nitrogen_dioxide
  Returns: First hourly reading [0] for each pollutant
  Timeout: 6 seconds
  Error handling: Returns None if API fails
```

---

## APIs & Integrations

### **1. OSRM (Open Source Routing Machine)**

**Purpose**: Calculate optimal routes between two points

**Endpoint**: `https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}`

**Query Params**:
```
?overview=full           # Full route geometry
&steps=true             # Turn-by-turn instructions
&alternatives=true      # Return 3 alternative routes
&geometries=polyline    # Encoded polyline format
```

**Response**:
```json
{
  "code": "Ok",
  "routes": [
    {
      "geometry": "aqdnA{erxM...",  // Encoded polyline
      "distance": 982105.5,           // meters
      "duration": 43270.5,            // seconds
      "legs": [...]
    }
  ]
}
```

**Usage in App**:
- Called after user clicks "Find Routes"
- Decodes polyline → array of [lat, lon] coordinates
- Routes displayed on map in different colors

---

### **2. Nominatim (OpenStreetMap Geocoding)**

**Purpose**: Convert addresses to coordinates (geocoding)

**Endpoint**: `https://nominatim.openstreetmap.org/search`

**Query Params**:
```
?format=json
&q={search_query}           # "Mumbai", "Delhi", etc.
&countrycodes=in            # Restrict to India
&limit=5                    # Return 5 results
```

**Response**:
```json
[
  {
    "place_id": 246861342,
    "lat": "19.0549990",
    "lon": "72.8692035",
    "display_name": "Mumbai, Maharashtra, India",
    "class": "place",
    "type": "city"
  }
]
```

**Usage in App**:
- Triggered on user input (debounced)
- Dropdown shows top 5 suggestions
- Click suggestion → auto-fill with coordinates

---

### **3. Open-Meteo Air Quality API**

**Purpose**: Real-time PM2.5 and NO2 data

**Endpoint**: `https://air-quality-api.open-meteo.com/v1/air-quality`

**Query Params**:
```
?latitude={lat}
&longitude={lon}
&hourly=pm2_5,nitrogen_dioxide
&timezone=UTC
```

**Response**:
```json
{
  "hourly": {
    "time": ["2026-07-03T10:00"],
    "pm2_5": [45.2],
    "nitrogen_dioxide": [12.5]
  }
}
```

**Usage in App**:
- Backend fetches for 15 sampled points per route
- Calculates average PM2.5/NO2
- Results cached for 6 hours

---

### **4. Leaflet (Map Rendering)**

**Purpose**: Interactive map visualization

**Features Used**:
- `L.map()` - Initialize map
- `L.tileLayer()` - OSM base map
- `L.polyline()` - Draw routes
- `L.marker()` - Mark start/end points
- `L.latLngBounds()` - Auto-zoom to fit
- `L.control.scale()` - Distance scale

**CSS**: `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css`

---

## Data Flow

### **Scenario: User Searches for Route**

```
1. USER INPUT
   ↓
   Start: "Mumbai"
   End: "Delhi"
   ↓

2. AUTOCOMPLETE PHASE
   ↓
   User types "Mumbai"
   → Nominatim API called
   → Returns [Mumbai city, Mumbai district, ...]
   → Dropdown shows suggestions
   → User clicks Mumbai
   → Input field filled: "19.0760, 72.8777"
   ↓

3. ROUTE FINDING PHASE
   ↓
   User clicks "Find Routes"
   ↓
   Frontend: parseCoordinates() extracts lat/lon
   ↓
   Frontend: Calls OSRM API with alternatives=true
   ↓
   OSRM Returns:
   - Route 1 (fastest): 18 hours, 1200 km
   - Route 2 (alternate): 19 hours, 1100 km
   - Route 3 (alternate): 20 hours, 950 km
   ↓
   Frontend: Draws 3 polylines on map (blue, green, purple)
   ↓

4. AQI DATA PHASE
   ↓
   For each route:
     - Sample 15 points along route
     - Send to Backend: POST /api/exposure
     ↓
   Backend:
     - For each point:
       - Check cache (3km grid, 6hr TTL)
       - If miss: Call Open-Meteo API
       - Store in cache
     - Calculate average PM2.5
     ↓
   Returns: { avg_pm2_5: 45.2, avg_no2: 12.5 }
   ↓

5. DISPLAY PHASE
   ↓
   Sidebar shows:
   ┌────────────────────┐
   │ Route 1            │
   │ 1200 km | 18 hrs   │
   │ PM2.5: 45.2 🟢     │ ← Green (good air)
   └────────────────────┘
   ┌────────────────────┐
   │ Route 2            │
   │ 1100 km | 19 hrs   │
   │ PM2.5: 62.1 🟡     │ ← Yellow (moderate)
   └────────────────────┘
   ┌────────────────────┐
   │ Route 3            │
   │ 950 km | 20 hrs    │
   │ PM2.5: 38.9 🟢     │ ← Green (best!)
   └────────────────────┘
   ↓

6. USER SELECTS BEST ROUTE
   ↓
   Clicks "Route 3" (lowest PM2.5)
   ↓
   Map highlights Route 3 in bright green
   ↓
   User follows directions with confidence!
```

---

## Deployment

### **Local Development (Codespaces)**

**Start Frontend**:
```bash
cd /workspaces/aqi_navigation
npm run dev
# Runs on http://localhost:5173
```

**Start Backend**:
```bash
cd backend
python main.py
# Runs on http://127.0.0.1:5000
```

**Codespaces Port Forwarding**:
```
Frontend: https://{codespace-name}-5173.app.github.dev
Backend:  https://{codespace-name}-5000.app.github.dev
```

### **Production Deployment**

**Option 1: Render or Heroku**
- Set `FLASK_ENV=production`
- Use gunicorn: `gunicorn -w 4 main:app`
- See `DEPLOY_NETLIFY_RENDER.md`

**Option 2: Docker**
```dockerfile
FROM python:3.9
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ .
CMD ["gunicorn", "-w", "4", "main:app"]
```

---

## Performance Considerations

### **Frontend Optimization**

| Optimization | Implementation |
|--------------|-----------------|
| **Code Splitting** | Vite HMR for instant updates |
| **Lazy Loading** | React components load on mount |
| **Caching** | Browser caches OSM tiles |
| **Polyline Decoding** | Client-side (offloads server) |
| **Debouncing** | Autocomplete search throttled |

### **Backend Optimization**

| Optimization | Implementation |
|--------------|-----------------|
| **AQI Caching** | 3km grid cells, 6-hour TTL |
| **Connection Pooling** | `requests` session reuse |
| **Timeout Handling** | 6-second timeout on external APIs |
| **Error Graceful** | Returns None on API failure |
| **Sample Points** | Max 15 points per route (vs all) |

### **Network Optimization**

| Feature | Impact |
|---------|--------|
| GZIP Compression | Reduces HTML/JS size ~60% |
| Polyline Encoding | ~95% reduction vs lat/lon array |
| OSM Tile Caching | Browser cache for repeated regions |
| API Response Caching | 6-hour TTL reduces external calls |

### **Benchmark Targets**

- **Autocomplete**: <500ms response
- **Route Finding**: 1-3 seconds (OSRM)
- **AQI Fetching**: 500ms-2s (parallel requests)
- **Map Rendering**: <100ms polyline draw
- **Total UX Time**: 3-5 seconds from click to display

---

## Error Handling

### **Frontend**

```javascript
try {
  // OSRM routing
  // Nominatim geocoding
  // AQI fetching
} catch (e) {
  console.error('Error:', e)
  alert('Error finding routes. Please try again.')
}
```

### **Backend**

```python
try:
  # Open-Meteo API call
  r = requests.get(url, timeout=6)
  if not r.ok:
    return {"pm2_5": None, "no2": None}
except Exception as e:
  print('Open-Meteo error', e)
  return {"pm2_5": None, "no2": None}
```

### **Graceful Degradation**

- If AQI API fails: Show routes without pollution data
- If Nominatim fails: User enters coordinates manually
- If OSRM fails: User gets alert to try different coordinates
- If map fails: Routes still accessible in sidebar

---

## Security Considerations

### **CORS**
- Backend allows all origins: `CORS(app)` (for development)
- Production: Configure allowed origins

### **Rate Limiting**
- OSRM: ~600 requests/min limit
- Nominatim: ~1 request/sec recommended
- Open-Meteo: Free tier: 10k requests/day

### **Input Validation**
- Regex validation for coordinates
- Nominatim filters to India only
- JSON schema validation on POST

---

## Future Enhancements

1. **Real-time Traffic Integration**
   - Add Mapbox Traffic Layer
   - Factor traffic into route selection

2. **Machine Learning**
   - Predict pollution patterns
   - Recommend best time to travel

3. **User Accounts**
   - Save favorite routes
   - Personalized recommendations

4. **Mobile App**
   - React Native version
   - Turn-by-turn navigation
   - GPS integration

5. **Advanced Filtering**
   - Route type: highways, scenic, etc.
   - Cost factor: toll roads
   - Health factor: green areas nearby

---

**Generated**: 2026-07-03
**Version**: 1.0
**Status**: Production Ready ✅
