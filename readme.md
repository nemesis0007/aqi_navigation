
TechFusion: Eco-Route Navigator
Breathe Better. Navigate Smarter.

MVP LINK : https://nemesis0007.github.io/aqi_navigation/

TechFusion is an AI-powered navigation platform designed to reduce human exposure to urban air pollution. By integrating real-time air quality data with advanced machine learning, we prioritize health over speed, finding the cleanest path through your city.
At the core of TechFusion is a Random Forest Regressor trained on historical environmental and traffic datasets.Traffic Impact Insight: Our model identifies that traffic density accounts for 13.30% of local AQI fluctuations.Predictive Analysis: The engine uses temperature, wind speed, and traffic load to forecast AQI levels for optimized route planning.Health-Optimized Routing: We calculate an Exposure Risk Score ($AQI \times Time$) to ensure users are not just taking a shorter route, but a healthier one.
Frontend: React.js, Tailwind CSS, Lucide Icons (Apple-style Glassmorphism UI)

Backend: Python Flask (Health-Optimized Route Engine)

AI/ML: Scikit-learn (Random Forest), Pandas, NumPy

Data Sources: IQAir (AirVisual) Community API for real-time station data

Cloud: Google Cloud (BigQuery, IAM), Firebase Hosting

Maps: Google Maps JavaScript API (Geospatial Visualization)