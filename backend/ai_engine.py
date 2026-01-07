import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import joblib

def train_model():
    # Feature logic: Temp, Wind, Traffic -> Predicted AQI [cite: 22, 28]
    data = {
        'temp': [22, 28, 35, 20, 24],
        'wind': [10, 5, 2, 8, 12],
        'traffic': [0.5, 0.9, 0.1, 0.4, 0.7],
        'aqi': [80, 150, 200, 70, 110]
    }
    df = pd.DataFrame(data)
    
    X = df[['temp', 'wind', 'traffic']]
    y = df['aqi']
    
    model = RandomForestRegressor(n_estimators=100)
    model.fit(X, y)
    
    # Save the model to the models folder [cite: 46]
    joblib.dump(model, 'backend/models/aqi_predictor.pkl')
    print("✓ AI Model Trained and Ready.")

if __name__ == "__main__":
    train_model()