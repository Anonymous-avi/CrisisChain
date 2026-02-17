from google import genai
import os
import json

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))


def calculate_risk_score_and_response_time(description: str, category: str, severity: str):
    """
    Use AI to calculate risk score (0-1) and estimated response time (minutes).
    
    Args:
        description: Incident description
        category: Incident category
        severity: AI-predicted severity (low, medium, high, critical)
    
    Returns:
        Tuple of (risk_score: float, estimated_response_time: int)
    """
    
    prompt = f"""
You are an emergency response AI system. Analyze this incident and return a JSON response.

Incident Details:
- Description: {description}
- Category: {category}
- Severity: {severity}

Return ONLY a valid JSON object (no markdown, no extra text) with exactly these fields:
{{
  "risk_score": <float between 0 and 1, where 1 is most critical>,
  "estimated_response_time": <integer minutes, reasonable estimate>
}}

Examples:
- Structure fire with people inside: {{"risk_score": 0.95, "estimated_response_time": 8}}
- Medical emergency: {{"risk_score": 0.85, "estimated_response_time": 10}}
- Minor accident: {{"risk_score": 0.3, "estimated_response_time": 20}}
- Lost person: {{"risk_score": 0.6, "estimated_response_time": 25}}
"""
    
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )
        
        response_text = response.text.strip()
        
        # Remove markdown code blocks if present
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]
        
        response_text = response_text.strip()
        
        data = json.loads(response_text)
        
        risk_score = float(data.get("risk_score", 0.5))
        response_time = int(data.get("estimated_response_time", 15))
        
        # Clamp values
        risk_score = max(0.0, min(1.0, risk_score))
        response_time = max(1, min(120, response_time))  # 1-120 minutes
        
        return risk_score, response_time
        
    except Exception as e:
        print(f"AI calculation error: {e}")
        # Fallback based on severity
        severity_mapping = {
            "critical": (0.9, 5),
            "high": (0.75, 10),
            "medium": (0.5, 15),
            "low": (0.3, 25)
        }
        return severity_mapping.get(severity.lower(), (0.5, 15))
