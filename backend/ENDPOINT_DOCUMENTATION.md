# POST /predict-severity Endpoint

## Overview
FastAPI endpoint that predicts crisis severity using a scikit-learn RandomForestClassifier model.

## Endpoint Details

**Path:** `/predict-severity`  
**Method:** `POST`  
**Content-Type:** `application/json`

## Request Body

```json
{
  "type": "fire",
  "location_type": "urban",
  "people_affected": 100,
  "time_of_day": "day"
}
```

### Field Descriptions

| Field | Type | Required | Description | Examples |
|-------|------|----------|-------------|----------|
| `type` | string | Yes | Incident/crisis type | "fire", "medical", "accident", "flood", "earthquake", "hazmat" |
| `location_type` | string | Yes | Geographic area classification | "urban", "rural" |
| `people_affected` | integer | Yes | Number of people impacted | 0-1000+ |
| `time_of_day` | string | Yes | Time period of incident | "day", "night" |

## Response Format

### Success Response (200 OK)

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

### Error Response (if prediction fails)

```json
{
  "error": "error message",
  "severity": "HIGH"
}
```

## Severity Values

The model predicts one of three severity levels:
- **LOW** - Minor incident, limited scope
- **MEDIUM** - Moderate impact, wider coordination needed
- **HIGH** - Major incident, extensive resources required

## Example CURL Request

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

## Example Python Request

```python
import requests

payload = {
    "type": "fire",
    "location_type": "urban",
    "people_affected": 100,
    "time_of_day": "day"
}

response = requests.post(
    "http://localhost:8000/predict-severity",
    json=payload
)

severity = response.json()["severity"]
print(f"Predicted Severity: {severity}")
```

## Example JavaScript Request

```javascript
const payload = {
  type: "fire",
  location_type: "urban",
  people_affected: 100,
  time_of_day: "day"
};

fetch("http://localhost:8000/predict-severity", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
})
.then(response => response.json())
.then(data => {
  console.log("Predicted Severity:", data.severity);
})
.catch(error => console.error("Error:", error));
```

## Running the Backend

To start the FastAPI server:

```bash
cd backend
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`

## Testing

The project includes `test_endpoint.py` for testing the endpoint:

```bash
cd backend
python test_endpoint.py
```

This script tests the endpoint with multiple sample scenarios and displays the results.

## Integration with Frontend

The frontend can call this endpoint to get severity predictions before creating an incident, or to show real-time severity estimates for user input.
