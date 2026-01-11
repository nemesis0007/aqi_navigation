import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
import time

app = Flask(__name__)
CORS(app)

# NOTE (hackathon): switching to Open-Meteo (no auth) for India-wide coverage.
# The Open-Meteo Air Quality API returns hourly pollutant time-series for a
# given latitude/longitude. For simplicity we take the first available hourly
# value. This backend endpoint is optional — the frontend already performs
# routing and exposure scoring. This provides a small helper that, given a
# list of sampled points, returns their PM2.5 and NO2 readings.
OPEN_METEO_AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'

# Simple in-memory cache for point AQI results. Keyed by rounded lat/lon grid.
# Cache values: { 'pm2_5': float|None, 'no2': float|None }
AQI_CACHE = {}
AQI_CACHE_GRID = 0.03  # ~3km grid
AQI_CACHE_TTL = 60 * 60 * 6  # seconds (6 hours)

def _cache_key(lat, lon):
    rlat = round(lat / AQI_CACHE_GRID) * AQI_CACHE_GRID
    rlon = round(lon / AQI_CACHE_GRID) * AQI_CACHE_GRID
    return f"{rlat:.5f}_{rlon:.5f}"

def fetch_open_meteo(lat, lon):
    """Fetch PM2.5 and NO2 for a coordinate using Open-Meteo with caching.

    Returns a dict {pm2_5: float|None, no2: float|None}.
    Caches results in-memory for short TTL to reduce rate of external calls.
    """
    try:
        key = _cache_key(lat, lon)
        now = int(time.time())
        entry = AQI_CACHE.get(key)
        if entry and (now - entry.get('ts', 0)) < AQI_CACHE_TTL:
            return entry.get('val', {"pm2_5": None, "no2": None})

        url = f"{OPEN_METEO_AQ_URL}?latitude={lat}&longitude={lon}&hourly=pm2_5,nitrogen_dioxide&timezone=UTC"
        r = requests.get(url, timeout=6)
        if not r.ok:
            AQI_CACHE[key] = { 'val': {"pm2_5": None, "no2": None}, 'ts': now }
            return {"pm2_5": None, "no2": None}
        j = r.json()
        pm = j.get('hourly', {}).get('pm2_5', [])
        no2 = j.get('hourly', {}).get('nitrogen_dioxide', [])
        val = {"pm2_5": (pm[0] if pm else None), "no2": (no2[0] if no2 else None)}
        AQI_CACHE[key] = { 'val': val, 'ts': now }
        return val
    except Exception as e:
        print('Open-Meteo error', e)
        return {"pm2_5": None, "no2": None}


@app.route('/api/exposure', methods=['POST'])
def exposure():
    """Accepts JSON: { points: [{lat: float, lon: float}, ...] }

    Returns per-point pollutants and a simple average exposure estimate.
    This endpoint is intentionally simple for hackathon use and does not
    implement caching or rate-limit handling.
    """
    data = request.get_json() or {}
    points = data.get('points') or []
    results = []
    total_pm = 0.0
    total_no2 = 0.0
    count_pm = 0
    count_no2 = 0
    for p in points:
        lat = p.get('lat')
        lon = p.get('lon')
        if lat is None or lon is None:
            results.append({"pm2_5": None, "no2": None})
            continue
        vals = fetch_open_meteo(lat, lon)
        results.append(vals)
        if vals.get('pm2_5') is not None:
            total_pm += vals['pm2_5']; count_pm += 1
        if vals.get('no2') is not None:
            total_no2 += vals['no2']; count_no2 += 1

    avg_pm = (total_pm / count_pm) if count_pm else None
    avg_no2 = (total_no2 / count_no2) if count_no2 else None
    return jsonify({"points": results, "avg_pm2_5": avg_pm, "avg_no2": avg_no2})


if __name__ == '__main__':
    app.run(port=5000)