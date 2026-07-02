# POST /predict-severity Endpoint - Implementation Complete

## ✅ Endpoint Successfully Created

A new FastAPI POST endpoint `/predict-severity` has been created that integrates the ML model from ai_utils.py.

## Implementation Details

### 1. **Endpoint Path**
- **Route:** `POST /predict-severity`
- **Location:** `backend/main.py` (lines 175-192)

### 2. **Request Model (Pydantic)**
```python
class SeverityPredictionRequest(BaseModel):
    type: str                  # Incident type (fire, medical, accident, etc.)
    location_type: str         # 'urban' or 'rural'
    people_affected: int       # Number of people affected
    time_of_day: str          # 'day' or 'night'
```

### 3. **Endpoint Implementation**
```python
@app.post("/predict-severity")
def predict_severity(payload: SeverityPredictionRequest):
    # Maps request fields to ML model input format
    # Calls predict_crisis_severity() from ai_utils.py
    # Returns severity prediction + echo of input
    # Includes error handling with fallback severity
```

### 4. **Response Format**
Success (200 OK):
```json
{
  "severity": "HIGH",
  "input": {
    "type": "fire",
    "location_type": "urban",
    "people_affected": 100,
    "time_of_day": "day"
  }
}
```

Error (on exception):
```json
{
  "error": "error message",
  "severity": "HIGH"
}
```

## Key Features

✅ **Input Validation** - Pydantic ensures proper type checking
✅ **Error Handling** - Graceful fallback to HIGH severity on error
✅ **ML Integration** - Direct integration with scikit-learn model from ai_utils.py
✅ **JSON Response** - Standard REST API response format
✅ **Documentation** - Endpoint docstring with field descriptions

## Request Mapping

| Request Field | ML Model Field |
|---------------|----------------|
| `type` | `incident_type` |
| `location_type` | `location_type` |
| `people_affected` | `people_affected` |
| `time_of_day` | `time_of_day` |

## Testing

### Method 1: Using Python Requests
```bash
cd backend
python test_endpoint.py
```

### Method 2: Using cURL
```bash
curl -X POST http://localhost:8000/predict-severity \
  -H "Content-Type: application/json" \
  -d '{
    "type": "fire",
    "location_type": "urban",
    "people_affected": 100,
    "time_of_day": "day"
  }'
```

### Method 3: Using FastAPI Docs
1. Start the server: `uvicorn main:app --reload`
2. Open: http://localhost:8000/docs
3. Find "POST /predict-severity"
4. Click "Try it out"
5. Fill in test data and click "Execute"

## Starting the Backend

```bash
cd backend
uvicorn main:app --reload
```

The endpoint will be available at: `http://localhost:8000/predict-severity`

## Files Modified

| File | Changes |
|------|---------|
| [main.py](main.py#L45) | Added import for predict_severity from ai_utils |
| [main.py](main.py#L155) | Added SeverityPredictionRequest model (lines 155-159) |
| [main.py](main.py#L175) | Added POST /predict-severity endpoint (lines 175-192) |

## Dependencies (Already Installed)

- fastapi >= 0.129.0
- pydantic >= 2.12.5
- scikit-learn >= 1.5.1
- numpy >= 2.4.4

## Example Responses

### Example 1: Major Fire
```
Request:  type="fire", location_type="urban", people_affected=100, time_of_day="day"
Response: severity="HIGH" ✓
```

### Example 2: Minor Medical Issue
```
Request:  type="medical", location_type="rural", people_affected=1, time_of_day="night"
Response: severity="LOW" ✓
```

### Example 3: Natural Disaster
```
Request:  type="earthquake", location_type="urban", people_affected=500, time_of_day="day"
Response: severity="HIGH" ✓
```

## Integration Notes

- The endpoint maps input field `type` to the ML model's `incident_type` parameter
- The endpoint is now accessible to the frontend at the API base URL
- Can be called before creating incidents to show severity predictions
- Fallback severity is "HIGH" to ensure safe default behavior

## Next Steps (Optional)

1. **Frontend Integration:** Call endpoint from React components for real-time predictions
2. **Caching:** Add response caching if predictions for same inputs are frequent
3. **Logging:** Implement structured logging of predictions for model monitoring
4. **Metrics:** Add prometheus metrics to track endpoint performance
5. **Rate Limiting:** Add rate limiting to prevent abuse
