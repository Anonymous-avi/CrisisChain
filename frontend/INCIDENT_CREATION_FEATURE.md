# Incident Creation with Severity Prediction - Frontend Implementation

## Overview
The Incidents page now includes a comprehensive incident creation form that integrates with the backend's ML-powered severity prediction API.

## Features Implemented

### 1. **Create Incident Button**
- Located at the top of the incident list
- Opens the incident creation form when clicked
- Button is hidden when form is open

### 2. **Predicted Severity Section**
A dedicated section for ML-based severity prediction with the following inputs:

| Field | Type | Options | Purpose |
|-------|------|---------|---------|
| Incident Type | Dropdown | Fire, Medical, Accident, Flood, Earthquake, Hazmat | Type of crisis |
| Location Type | Dropdown | Urban, Rural | Geographic classification |
| People Affected | Number | 0-∞ | Population impact |
| Time of Day | Dropdown | Day, Night | Temporal context |

**Predict Button:** 
- Calls `POST /predict-severity` endpoint
- Sends: `type`, `location_type`, `people_affected`, `time_of_day`
- Displays predicted severity with color coding:
  - 🔴 HIGH (red)
  - 🟠 MEDIUM (orange)
  - 🟢 LOW (green)

### 3. **Incident Details Section**

| Field | Type | Purpose |
|-------|------|---------|
| Description | Textarea | Full text description of the incident |
| Category | Dropdown | Fire, Medical, Accident, Flood, Earthquake, Hazmat |
| Latitude | Number | Geographic coordinate |
| Longitude | Number | Geographic coordinate |

### 4. **Form Submission**
- **Create Button:** Submits incident to backend
- **Validation:** Requires predicted severity before submission
- **Error Handling:** Alerts user on prediction or creation failure
- **Success:** Resets form and refreshes incident list

## User Flow

```
1. User clicks "Create New Incident"
   ↓
2. Form appears with severity prediction section
   ↓
3. User fills in:
   - Incident type
   - Location type
   - People affected
   - Time of day
   ↓
4. User clicks "Predict Severity"
   ↓
5. Backend ML model predicts severity
   ↓
6. Predicted severity displayed in colored badge
   ↓
7. User fills in remaining details:
   - Description
   - Category
   - Coordinates
   ↓
8. User clicks "Create Incident"
   ↓
9. Incident created and form closes
   ↓
10. Incident list refreshed automatically
```

## API Integration

### Severity Prediction Endpoint
**Request:**
```javascript
POST http://127.0.0.1:8000/predict-severity
Content-Type: application/json

{
  "type": "fire",
  "location_type": "urban",
  "people_affected": 100,
  "time_of_day": "day"
}
```

**Response:**
```javascript
{
  "severity": "HIGH",
  "input": { ... }
}
```

### Create Incident Endpoint
**Request:**
```javascript
POST http://127.0.0.1:8000/create-incident
Content-Type: application/json

{
  "description": "Large building fire in downtown area",
  "category": "fire",
  "latitude": 28.6139,
  "longitude": 77.209
}
```

## State Management

### Form State (`formData`)
```javascript
{
  type: string,              // Incident type
  location_type: string,     // Urban or rural
  people_affected: number,   // Population impact
  time_of_day: string,      // Day or night
  description: string,       // Full description
  category: string,         // Incident category
  latitude: number,         // Geographic coordinate
  longitude: number         // Geographic coordinate
}
```

### UI State
- `showCreateForm`: Boolean to toggle form visibility
- `predictedSeverity`: Cached prediction result (null, "LOW", "MEDIUM", "HIGH")
- `isLoadingSeverity`: Loading indicator for API request

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Predict without severity | Alert: "Please predict severity first!" |
| Missing description | Alert: "Please enter a description!" |
| API prediction fails | Alert: "Error predicting severity: [error]" |
| API create fails | Alert: "Failed to create incident" |

## Code Changes

**File Modified:** `frontend/src/pages/Incidents.jsx`

**Functions Added:**
- `predictSeverity()` - Calls /predict-severity API
- `createIncident()` - Creates incident with predicted severity

**State Variables Added:**
- `showCreateForm` - Toggle form visibility
- `predictedSeverity` - Store prediction result
- `isLoadingSeverity` - Loading state
- `formData` - Form input values

## UI/UX Details

### Form Styling
- Dark theme matching existing design
- Sections separated by colored backgrounds
- Color-coded severity display
- Loading states with visual feedback
- Close buttons for easy dismissal

### Form Sections
1. **Prediction Panel** - For severity prediction inputs
2. **Details Panel** - For incident description and metadata
3. **Action Buttons** - Create and Cancel buttons

## Testing the Feature

1. **Start the backend:**
   ```bash
   cd backend
   uvicorn main:app --reload
   ```

2. **Open the frontend** and navigate to the Incidents page

3. **Click "Create New Incident"** button

4. **Test Severity Prediction:**
   - Select incident type: "fire"
   - Select location: "urban"
   - Set people affected: 100
   - Set time: "day"
   - Click "Predict Severity"
   - Should see "HIGH" prediction

5. **Fill incident details:**
   - Description: "Large structure fire"
   - Category: "fire"
   - Coordinates: Auto-filled with default location
   - Click "Create Incident"

6. **Verify:** New incident appears in the list below

## Notes

- Default location is New Delhi (28.6139, 77.209)
- Form resets after successful submission
- WebSocket automatically updates incident list in real-time
- Predicted severity is required to submit the form
- All fields are properly validated
