# Crisis Severity Prediction Model - Implementation Summary

## Overview
A machine learning model has been successfully implemented using scikit-learn's `RandomForestClassifier` to predict crisis severity levels (LOW, MEDIUM, HIGH) based on incident characteristics.

## Model Architecture

### Input Features
The model accepts the following inputs via the `predict_severity()` function:

1. **incident_type** (string): Type of crisis event
   - Examples: 'fire', 'medical', 'accident', 'flood', 'earthquake', 'hazmat'

2. **location_type** (string): Geographic location classification
   - Options: 'urban' or 'rural'

3. **people_affected** (int): Number of people impacted by the incident
   - Numeric value that influences severity assessment

4. **time_of_day** (string): Temporal context of the incident
   - Options: 'day' or 'night' (affects response coordination)

### Output
- **Predicted Severity**: String label ('LOW', 'MEDIUM', or 'HIGH')

## Training Data
The model is trained on a predefined dataset of 24 incidents covering:
- Multiple incident types (fire, medical, accident, flood, earthquake, hazmat)
- Geographic variations (urban/rural)
- Population impact scales (1-500 people)
- Time variations (day/night)
- Realistic severity labels based on incident characteristics

## Technical Implementation

### Preprocessing
- **Categorical Encoding**: LabelEncoder transforms text features (incident_type, location_type, time_of_day) into numeric values
- **Feature Normalization**: All features are properly scaled for the classifier

### Model Details
- **Algorithm**: RandomForestClassifier
  - 50 estimators
  - Max depth: 10 layers
  - Random state: 42 (for reproducibility)
  
### Fallback Logic
If prediction fails or unknown values are encountered:
- Returns 'HIGH' if people_affected > 100
- Returns 'MEDIUM' if people_affected > 10
- Returns 'LOW' otherwise

## Function Signature

```python
def predict_severity(input_data: dict) -> str:
    """
    Predict crisis severity based on incident characteristics.
    
    Args:
        input_data (dict): Dictionary with keys:
            - incident_type (str): Type of incident
            - location_type (str): 'urban' or 'rural'
            - people_affected (int): Number of people affected
            - time_of_day (str): 'day' or 'night'
    
    Returns:
        str: Predicted severity ('LOW', 'MEDIUM', 'HIGH')
    """
```

## Test Results

| Test Case | Incident Type | Location | People Affected | Time | Prediction |
|-----------|---------------|----------|-----------------|------|------------|
| 1 | fire | urban | 100 | day | HIGH |
| 2 | medical | rural | 1 | night | LOW |
| 3 | earthquake | urban | 500 | day | HIGH |
| 4 | accident | rural | 2 | night | LOW |

## Integration Points

The model is integrated into the backend at `backend/ai_utils.py` alongside the existing `calculate_risk_score_and_response_time()` function. It can be easily imported and used in the FastAPI application:

```python
from ai_utils import predict_severity

# Usage example
severity = predict_severity({
    'incident_type': 'fire',
    'location_type': 'urban',
    'people_affected': 50,
    'time_of_day': 'night'
})
# Returns: 'HIGH'
```

## Dependencies Added

- **scikit-learn (1.8.0)**: Machine learning library with RandomForestClassifier
- **numpy (2.4.4)**: Numerical computing library (dependency of scikit-learn)
- **scipy (1.17.1)**: Scientific computing library (dependency of scikit-learn)
- **joblib (1.5.3)**: Utilities for serialization (dependency of scikit-learn)
- **threadpoolctl (3.6.0)**: Thread pool utilities (dependency of scikit-learn)

## Files Modified/Created

1. **backend/ai_utils.py** - Added ML model implementation
2. **backend/requirements.txt** - Added scikit-learn and numpy dependencies
3. **backend/test_model.py** - Test script demonstrating model functionality

## Next Steps (Optional)

To further enhance the model:
1. **Expand Training Data**: Add more incident records for better generalization
2. **Feature Engineering**: Add temporal features (hour, day of week), location coordinates
3. **Model Tuning**: Optimize hyperparameters using GridSearchCV or RandomizedSearchCV
4. **Cross-Validation**: Implement k-fold cross-validation for better performance assessment
5. **Persistence**: Save trained model using joblib for faster loading in production
6. **Real-time Updates**: Implement model retraining with actual incident outcomes
