import { useState, useEffect, useRef } from 'react'
import './App.css'
import './styles.css'

function App() {
  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  const [preference, setPreference] = useState('fastest')
  const [routes, setRoutes] = useState([])
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [loading, setLoading] = useState(false)
  const [startSuggestions, setStartSuggestions] = useState([])
  const [endSuggestions, setEndSuggestions] = useState([])
  const mapRef = useRef(null)
  const routeLayersRef = useRef([])

  useEffect(() => {
    if (typeof L !== 'undefined') {
      initMap()
    }
  }, [])

  const initMap = () => {
    try {
      const mapEl = document.getElementById('map')
      if (!mapEl || mapEl._leaflet_map) return
      
      const map = L.map('map', { preferCanvas: true }).setView([22.5937, 78.9629], 5)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map)
      L.control.scale({ position: 'bottomleft' }).addTo(map)
      mapRef.current = map
    } catch (e) {
      console.error('Map init error:', e)
    }
  }

  // Geocoding using Nominatim
  const geocodeAddress = async (query) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=5`
      )
      const data = await response.json()
      return data.map(item => ({
        name: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon)
      }))
    } catch (e) {
      console.error('Geocoding error:', e)
      return []
    }
  }

  // Parse lat,lon from input
  const parseCoordinates = (input) => {
    const match = input.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/)
    if (match) {
      return { lat: parseFloat(match[1]), lon: parseFloat(match[2]) }
    }
    return null
  }

  // Handle address input with autocomplete
  const handleStartInput = async (value) => {
    setStartInput(value)
    if (value.length > 2) {
      const suggestions = await geocodeAddress(value)
      setStartSuggestions(suggestions)
    } else {
      setStartSuggestions([])
    }
  }

  const handleEndInput = async (value) => {
    setEndInput(value)
    if (value.length > 2) {
      const suggestions = await geocodeAddress(value)
      setEndSuggestions(suggestions)
    } else {
      setEndSuggestions([])
    }
  }

  // Select suggestion
  const selectStartSuggestion = (suggestion) => {
    setStartInput(`${suggestion.lat.toFixed(4)}, ${suggestion.lon.toFixed(4)}`)
    setStartSuggestions([])
  }

  const selectEndSuggestion = (suggestion) => {
    setEndInput(`${suggestion.lat.toFixed(4)}, ${suggestion.lon.toFixed(4)}`)
    setEndSuggestions([])
  }

  // Decode polyline (Google's algorithm)
  const decodePolyline = (str, precision = 1e5) => {
    let index = 0, lat = 0, lng = 0
    const coordinates = []
    while (index < str.length) {
      let shift = 0, result = 0, byte = null
      do {
        byte = str.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1))
      lat += deltaLat

      shift = 0
      result = 0
      do {
        byte = str.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1))
      lng += deltaLng

      coordinates.push([lat / precision, lng / precision])
    }
    return coordinates
  }

  // Sample points along a polyline
  const samplePointsFromCoordinates = (coords, maxPoints = 15) => {
    if (coords.length <= maxPoints) return coords
    const step = Math.ceil(coords.length / maxPoints)
    const sampled = []
    for (let i = 0; i < coords.length; i += step) {
      sampled.push(coords[i])
    }
    if (sampled[sampled.length - 1] !== coords[coords.length - 1]) {
      sampled.push(coords[coords.length - 1])
    }
    return sampled
  }

  // Fetch AQI data from backend
  const fetchAQIForRoutes = async (routeList) => {
    try {
      // Detect API URL based on environment
      const apiUrl = window.location.hostname === 'localhost' 
        ? 'http://localhost:5000/api/exposure'
        : `https://${window.location.hostname.replace('5173', '5000')}/api/exposure`

      const routesWithAQI = await Promise.all(routeList.map(async (route) => {
        const sampledPoints = samplePointsFromCoordinates(route.coordinates)
        const points = sampledPoints.map(coord => ({
          lat: coord[0],
          lon: coord[1]
        }))

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points })
        })

        if (response.ok) {
          const data = await response.json()
          return {
            ...route,
            pm25: data.avg_pm2_5 || 0,
            no2: data.avg_no2 || 0,
            points: data.points
          }
        }
        return route
      }))

      setRoutes(routesWithAQI)
    } catch (e) {
      console.error('AQI fetch error:', e)
    }
  }

  // Get routes from OSRM
  const findRoutes = async () => {
    const startCoords = parseCoordinates(startInput)
    const endCoords = parseCoordinates(endInput)

    if (!startCoords || !endCoords) {
      alert('Please enter valid start and end coordinates (lat, lon)')
      return
    }

    setLoading(true)
    try {
      // Get multiple routes from OSRM
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${startCoords.lon},${startCoords.lat};${endCoords.lon},${endCoords.lat}?overview=full&steps=true&alternatives=true&geometries=polyline`
      )
      const data = await response.json()

      if (data.routes && data.routes.length > 0) {
        // Decode polylines and prepare route data
        const routeList = data.routes.map((route, idx) => ({
          id: idx,
          distance: (route.distance / 1000).toFixed(2),
          duration: Math.round(route.duration / 60),
          polyline: route.geometry,
          coordinates: decodePolyline(route.geometry)
        }))

        setRoutes(routeList)

        // Display routes on map
        clearRoutesFromMap()
        routeList.forEach((route, idx) => {
          const color = idx === 0 ? '#007AFF' : idx === 1 ? '#34C759' : '#8B5CF6'
          const polylineLayer = L.polyline(route.coordinates, {
            color: color,
            weight: 3,
            opacity: 0.7
          }).addTo(mapRef.current)

          routeLayersRef.current.push(polylineLayer)
        })

        // Fit bounds to show all routes
        if (mapRef.current) {
          const allCoords = routeList.flatMap(r => r.coordinates)
          const bounds = L.latLngBounds(allCoords)
          mapRef.current.fitBounds(bounds, { padding: [50, 50] })
        }

        // Fetch AQI data for routes
        await fetchAQIForRoutes(routeList)
      } else {
        alert('No routes found. Please check your coordinates.')
      }
    } catch (e) {
      console.error('Route finding error:', e)
      alert('Error finding routes. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const clearRoutesFromMap = () => {
    routeLayersRef.current.forEach(layer => {
      if (mapRef.current) {
        mapRef.current.removeLayer(layer)
      }
    })
    routeLayersRef.current = []
  }

  const handleSelectRoute = (routeId) => {
    setSelectedRoute(routeId)
    clearRoutesFromMap()

    // Highlight selected route
    if (routes[routeId]) {
      const route = routes[routeId]
      const polylineLayer = L.polyline(route.coordinates, {
        color: '#34C759',
        weight: 4,
        opacity: 1
      }).addTo(mapRef.current)
      routeLayersRef.current.push(polylineLayer)
    }
  }

  const getAQIColor = (pm25) => {
    if (!pm25) return 'text-gray-400'
    if (pm25 < 50) return 'text-green-400'
    if (pm25 < 100) return 'text-yellow-400'
    if (pm25 < 150) return 'text-orange-400'
    return 'text-red-400'
  }

  return (
    <>
      <nav className="fixed w-full z-50 top-0 glass-panel border-b-0" id="navbar">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-lg tracking-tight">Eco-Route</span>
            </div>
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-6">
                <a href="#home" className="text-sm font-medium text-gray-300 hover:text-white transition-colors">Home</a>
                <a href="#map-section" className="btn-apple px-4 py-1.5 text-sm">Start</a>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <section id="home" className="relative pt-40 pb-20 lg:pt-56 lg:pb-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-5xl md:text-8xl font-bold mb-6 tracking-tighter">Breathe.<br />Better.</h1>
            <p className="text-xl md:text-2xl text-gray-400 mb-10 leading-relaxed font-light max-w-2xl mx-auto">
              India-wide route planner: choose routes that minimize your pollution exposure.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href="#map-section" className="btn-apple px-8 py-4 text-lg flex items-center justify-center">Plan Route</a>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-24 bg-[#050505]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="glass-card p-8 border border-white/5">
              <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center mb-6 text-blue-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <h3 className="text-xl font-bold mb-3">Real-Time Analysis</h3>
              <p className="text-gray-500 leading-relaxed">We fetch live air quality data from thousands of sensors to build a pollution map of your city.</p>
            </div>
            <div className="glass-card p-8 border border-white/5">
              <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center mb-6 text-green-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h3 className="text-xl font-bold mb-3">Health First</h3>
              <p className="text-gray-500 leading-relaxed">Our algorithms prioritize your lungs over speed, finding routes with the lowest AQI exposure.</p>
            </div>
            <div className="glass-card p-8 border border-white/5">
              <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center mb-6 text-purple-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 00-.553-.894L15 7m0 13V7" /></svg>
              </div>
              <h3 className="text-xl font-bold mb-3">Smart Routing</h3>
              <p className="text-gray-500 leading-relaxed">Seamlessly integrates with open-source maps to provide turn-by-turn navigation on the cleanest path.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-32 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl md:text-6xl font-bold mb-8 tracking-tight">Invisible Threat.<br />Visible Solution.</h2>
              <p className="text-xl text-gray-400 mb-6 font-light">Air pollution is the world's largest environmental health risk. Microscopic PM2.5 particles can penetrate deep into your lungs.</p>
              <p className="text-xl text-gray-400 font-light">By choosing a cleaner route, you can reduce your exposure on a single commute.</p>
            </div>
            <div className="relative">
              <div className="glass-panel p-8 rounded-3xl relative border border-white/10">
                <div className="flex items-center justify-between mb-8"><span className="text-sm font-medium text-gray-400">PM2.5 Exposure</span><span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">Saved</span></div>
                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-gray-500">Standard Route</span><span className="text-red-400">145 µg/m³</span></div>
                    <div className="w-full bg-white/5 rounded-full h-2"><div className="bg-red-500/50 h-2 rounded-full" style={{width: '85%'}}></div></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-white font-medium">Eco-Route</span><span className="text-green-400">45 µg/m³</span></div>
                    <div className="w-full bg-white/5 rounded-full h-2"><div className="bg-green-500 h-2 rounded-full" style={{width: '35%'}}></div></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="map-section" className="py-20 relative px-4">
        <div className="max-w-6xl mx-auto">
          <div className="glass-panel rounded-3xl overflow-hidden min-h-[80vh] flex flex-col md:flex-row shadow-2xl relative">
            <div className="w-full md:w-96 bg-black/40 backdrop-blur-xl p-8 border-r border-white/10 flex flex-col z-20">
              <h2 className="text-2xl font-bold mb-6 tracking-tight">Route Planner</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400">Start</label>
                  <div className="relative">
                    <input 
                      id="start-input" 
                      type="text" 
                      placeholder="Address or lat, lon (e.g. 12.9716, 77.5946)" 
                      className="w-full input-apple px-4 py-3 text-sm pr-10 rounded"
                      value={startInput}
                      onChange={(e) => handleStartInput(e.target.value)}
                    />
                    {startSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-[#1c1c1e] border border-white/10 rounded max-h-40 overflow-y-auto z-30">
                        {startSuggestions.map((s, i) => (
                          <button
                            key={i}
                            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/10 border-b border-white/5 last:border-b-0"
                            onClick={() => selectStartSuggestion(s)}
                          >
                            {s.name.split(',')[0]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-400">Destination</label>
                  <div className="relative">
                    <input 
                      id="end-input" 
                      type="text" 
                      placeholder="Address or lat, lon (e.g. 19.0760, 72.8777)" 
                      className="w-full input-apple px-4 py-3 text-sm pr-10 rounded"
                      value={endInput}
                      onChange={(e) => handleEndInput(e.target.value)}
                    />
                    {endSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-[#1c1c1e] border border-white/10 rounded max-h-40 overflow-y-auto z-30">
                        {endSuggestions.map((s, i) => (
                          <button
                            key={i}
                            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/10 border-b border-white/5 last:border-b-0"
                            onClick={() => selectEndSuggestion(s)}
                          >
                            {s.name.split(',')[0]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-400">Preference</label>
                  <div className="flex items-center gap-2 ml-2">
                    <button 
                      className={`pref-btn text-xs px-3 py-1 rounded-full ${preference === 'fastest' ? 'bg-blue-500 text-white' : 'bg-white/6'}`}
                      onClick={() => setPreference('fastest')}
                    >
                      Fastest
                    </button>
                    <button 
                      className={`pref-btn text-xs px-3 py-1 rounded-full ${preference === 'healthiest' ? 'bg-green-500 text-white' : 'bg-white/6'}`}
                      onClick={() => setPreference('healthiest')}
                    >
                      Healthiest
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 items-center">
                  <button 
                    onClick={findRoutes}
                    disabled={loading}
                    className="btn-apple px-4 py-2 disabled:opacity-50"
                  >
                    {loading ? 'Finding...' : 'Find Routes'}
                  </button>
                </div>
              </div>

              <div className="mt-6 flex-1 overflow-hidden flex flex-col">
                <h3 className="text-sm text-gray-400 mb-2">Routes</h3>
                <div className="space-y-2 overflow-y-auto flex-1">
                  {routes.length === 0 ? (
                    <p className="text-xs text-gray-500">Enter start and end points to find routes</p>
                  ) : (
                    routes.map((route, idx) => (
                      <button
                        key={route.id}
                        onClick={() => handleSelectRoute(route.id)}
                        className={`w-full text-left p-3 rounded border transition-all ${
                          selectedRoute === route.id 
                            ? 'bg-green-500/20 border-green-500/50' 
                            : 'bg-white/5 border-white/10 hover:border-white/20'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-medium">Route {idx + 1}</span>
                          {route.pm25 && (
                            <span className={`text-xs font-bold ${getAQIColor(route.pm25)}`}>
                              PM2.5: {route.pm25.toFixed(1)}
                            </span>
                          )}
                        </div>
                        <div className="flex justify-between text-xs text-gray-400">
                          <span>{route.distance} km</span>
                          <span>{route.duration} min</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="flex-1 relative bg-[#1c1c1e] z-10">
              <div id="map" className="w-full h-full"></div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

export default App
