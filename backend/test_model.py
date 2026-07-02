#!/usr/bin/env python3
"""Test script for crisis severity prediction model"""

from ai_utils import predict_severity

# Test cases
test_cases = [
    {
        'incident_type': 'fire',
        'location_type': 'urban',
        'people_affected': 100,
        'time_of_day': 'day'
    },
    {
        'incident_type': 'medical',
        'location_type': 'rural',
        'people_affected': 1,
        'time_of_day': 'night'
    },
    {
        'incident_type': 'earthquake',
        'location_type': 'urban',
        'people_affected': 500,
        'time_of_day': 'day'
    },
    {
        'incident_type': 'accident',
        'location_type': 'rural',
        'people_affected': 2,
        'time_of_day': 'night'
    }
]

print("Crisis Severity Prediction Model - Test Results")
print("=" * 60)
for i, test_case in enumerate(test_cases, 1):
    prediction = predict_severity(test_case)
    print(f"\nTest Case {i}:")
    print(f"  Incident Type: {test_case['incident_type']}")
    print(f"  Location: {test_case['location_type']}")
    print(f"  People Affected: {test_case['people_affected']}")
    print(f"  Time of Day: {test_case['time_of_day']}")
    print(f"  Predicted Severity: {prediction}")

print("\n" + "=" * 60)
print("Model testing completed successfully!")
