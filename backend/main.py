import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Use your IQAir Key from the screenshot
IQAIR_KEY = "8dfb7262-1ce0-4b29-9948-388224b0880f"

def get_real_aqi(lat, lng):
    """Fetches LIVE data from IQAir API for specific coordinates."""
    url = f"https://api.airvisual.com/v2/nearest_city?lat={lat}&lon={lng}&key={	8dfb7262-1ce0-4b29-9948-388224b0880f}"
    try:
        response = requests.get(url).json()
        if response['status'] == 'success':
            # 'aqius' is the US AQI standard used in your prediction models [cite: 13]
            return response['data']['current']['pollution']['aqius']
    except Exception as e:
        print(f"API Error: {e}")
    return 50 # Default safe fallback

@app.route('/api/analyze-routes', methods=['POST'])
def analyze_routes():
    # This endpoint receives the origin/destination from your React App [cite: 61]
    # and returns route comparisons based on inhaled pollution risk [cite: 30, 36]
    data = request.json
    # ... (Your logic to calculate routes via Google Maps API goes here)
    return jsonify({"message": "Ready for navigation scoring"})

if __name__ == '__main__':
    app.run(port=5000)