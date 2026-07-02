#!/usr/bin/env python3
"""Test script for /predict-severity endpoint"""

import requests
import json

# Test cases for the /predict-severity endpoint
test_cases = [
    {
        "type": "fire",
        "location_type": "urban",
        "people_affected": 100,
        "time_of_day": "day"
    },
    {
        "type": "medical",
        "location_type": "rural",
        "people_affected": 1,
        "time_of_day": "night"
    },
    {
        "type": "earthquake",
        "location_type": "urban",
        "people_affected": 500,
        "time_of_day": "day"
    },
    {
        "type": "accident",
        "location_type": "rural",
        "people_affected": 2,
        "time_of_day": "night"
    },
    {
        "type": "flood",
        "location_type": "urban",
        "people_affected": 200,
        "time_of_day": "day"
    }
]

# Base URL (update if your API is running on a different host/port)
BASE_URL = "http://localhost:8000"

print("Testing /predict-severity endpoint")
print("=" * 70)

for i, test_case in enumerate(test_cases, 1):
    try:
        response = requests.post(
            f"{BASE_URL}/predict-severity",
            json=test_case,
            timeout=10
        )
        
        print(f"\nTest Case {i}:")
        print(f"  Request: {json.dumps(test_case, indent=2)}")
        print(f"  Status Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"  Response: {json.dumps(result, indent=2)}")
            print(f"  ✓ Predicted Severity: {result.get('severity', 'N/A')}")
        else:
            print(f"  Error: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print(f"\nTest Case {i}:")
        print(f"  Error: Cannot connect to {BASE_URL}")
        print(f"  Make sure the backend is running with 'uvicorn main:app --reload'")
        break
    except Exception as e:
        print(f"\nTest Case {i}:")
        print(f"  Error: {str(e)}")

print("\n" + "=" * 70)
print("Test completed!")
print("\nTo run the backend server, execute:")
print("  cd backend")
print("  uvicorn main:app --reload")
