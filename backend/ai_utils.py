from google import genai
import os
import json
import smtplib
import ssl
import numpy as np
import re
import spacy
from email.message import EmailMessage
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.preprocessing import LabelEncoder
import pickle
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

# ==================== ML Model for Crisis Severity Prediction ====================

# Training dataset
TRAINING_DATA = {
    'incident_type': [
        'fire', 'fire', 'fire', 'fire', 'medical', 'medical', 'medical', 'medical',
        'accident', 'accident', 'accident', 'accident', 'flood', 'flood', 'flood', 'flood',
        'earthquake', 'earthquake', 'earthquake', 'earthquake', 'hazmat', 'hazmat', 'hazmat', 'hazmat'
    ],
    'location_type': [
        'urban', 'urban', 'rural', 'rural', 'urban', 'urban', 'rural', 'rural',
        'urban', 'urban', 'rural', 'rural', 'urban', 'urban', 'rural', 'rural',
        'urban', 'urban', 'rural', 'rural', 'urban', 'urban', 'rural', 'rural'
    ],
    'people_affected': [
        50, 5, 20, 3, 10, 1, 50, 5,
        30, 5, 15, 2, 200, 50, 100, 10,
        500, 100, 300, 50, 100, 10, 50, 5
    ],
    'time_of_day': [
        'day', 'night', 'day', 'night', 'day', 'night', 'day', 'night',
        'day', 'night', 'day', 'night', 'day', 'night', 'day', 'night',
        'day', 'night', 'day', 'night', 'day', 'night', 'day', 'night'
    ],
    'severity': [
        'HIGH', 'HIGH', 'MEDIUM', 'MEDIUM', 'HIGH', 'LOW', 'MEDIUM', 'LOW',
        'MEDIUM', 'LOW', 'LOW', 'LOW', 'HIGH', 'HIGH', 'MEDIUM', 'MEDIUM',
        'HIGH', 'HIGH', 'HIGH', 'MEDIUM', 'HIGH', 'MEDIUM', 'MEDIUM', 'LOW'
    ]
}

# Initialize encoders and model
_incident_encoder = LabelEncoder()
_location_encoder = LabelEncoder()
_time_encoder = LabelEncoder()
_severity_encoder = LabelEncoder()
_model = None

# ==================== ML Model for Resolution Time Prediction ====================

RESOLUTION_TRAINING_DATA = {
    "severity": [
        "LOW", "LOW", "LOW", "LOW", "LOW", "LOW",
        "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM",
        "HIGH", "HIGH", "HIGH", "HIGH", "HIGH", "HIGH", "HIGH", "HIGH",
    ],
    "people_affected": [
        1, 3, 5, 8, 10, 15,
        10, 15, 20, 30, 40, 50, 70, 90,
        30, 50, 80, 120, 180, 250, 350, 500,
    ],
    "location_type": [
        "urban", "rural", "urban", "rural", "urban", "rural",
        "urban", "urban", "rural", "urban", "rural", "urban", "rural", "urban",
        "urban", "rural", "urban", "rural", "urban", "rural", "urban", "rural",
    ],
    "incident_type": [
        "medical", "accident", "accident", "medical", "fire", "accident",
        "medical", "fire", "accident", "flood", "fire", "hazmat", "flood", "earthquake",
        "fire", "flood", "earthquake", "hazmat", "fire", "flood", "earthquake", "hazmat",
    ],
    "resolution_time_minutes": [
        12, 18, 20, 24, 28, 35,
        30, 38, 42, 48, 55, 62, 75, 88,
        65, 80, 95, 110, 130, 150, 175, 210,
    ],
}

_rt_severity_encoder = LabelEncoder()
_rt_location_encoder = LabelEncoder()
_rt_incident_encoder = LabelEncoder()
_resolution_time_model = None


def _train_resolution_time_model():
    """Train RandomForestRegressor to estimate incident resolution time in minutes."""
    global _resolution_time_model

    severity_encoded = _rt_severity_encoder.fit_transform(RESOLUTION_TRAINING_DATA["severity"])
    location_encoded = _rt_location_encoder.fit_transform(RESOLUTION_TRAINING_DATA["location_type"])
    incident_encoded = _rt_incident_encoder.fit_transform(RESOLUTION_TRAINING_DATA["incident_type"])

    X = np.column_stack([
        severity_encoded,
        RESOLUTION_TRAINING_DATA["people_affected"],
        location_encoded,
        incident_encoded,
    ])

    y = np.array(RESOLUTION_TRAINING_DATA["resolution_time_minutes"], dtype=float)

    _resolution_time_model = RandomForestRegressor(
        n_estimators=120,
        random_state=42,
        max_depth=12,
    )
    _resolution_time_model.fit(X, y)

# Lightweight spaCy pipeline for tokenization and rule-based extraction.
_nlp = spacy.blank("en")

INCIDENT_KEYWORDS = {
    "fire": {"fire", "flame", "smoke", "burn", "burning", "blaze"},
    "flood": {"flood", "flooding", "waterlog", "overflow", "inundation"},
    "accident": {"accident", "crash", "collision", "pileup", "wreck"},
    "earthquake": {"earthquake", "quake", "tremor", "aftershock", "seismic"},
}

NUMBER_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
    "hundred": 100,
}


def _word_to_number(token_text: str):
    """Convert simple number words to integer when possible."""
    text = token_text.strip().lower()
    if text in NUMBER_WORDS:
        return NUMBER_WORDS[text]
    return None


def send_email_alert(to_email, subject, message):
    """
    Send an email alert using Gmail SMTP.

    Environment variables used:
    - ALERT_EMAIL or EMAIL_ADDRESS or GMAIL_EMAIL
    - ALERT_EMAIL_PASSWORD or EMAIL_PASSWORD or GMAIL_APP_PASSWORD

    Args:
        to_email: Recipient email address.
        subject: Email subject.
        message: Email body.

    Returns:
        bool: True if sent successfully, otherwise False.
    """
    sender_email = (
        os.getenv("ALERT_EMAIL")
        or os.getenv("EMAIL_ADDRESS")
        or os.getenv("GMAIL_EMAIL")
    )
    sender_password = (
        os.getenv("ALERT_EMAIL_PASSWORD")
        or os.getenv("EMAIL_PASSWORD")
        or os.getenv("GMAIL_APP_PASSWORD")
    )

    try:
        if not sender_email or not sender_password:
            raise ValueError(
                "Missing email credentials. Set ALERT_EMAIL and ALERT_EMAIL_PASSWORD "
                "(or EMAIL_ADDRESS/EMAIL_PASSWORD, GMAIL_EMAIL/GMAIL_APP_PASSWORD)."
            )

        if not to_email or not subject or message is None:
            raise ValueError("to_email, subject, and message are required.")

        email_message = EmailMessage()
        email_message["From"] = sender_email
        email_message["To"] = str(to_email).strip()
        email_message["Subject"] = str(subject).strip()
        email_message.set_content(str(message))

        context = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=20) as smtp:
            smtp.login(sender_email, sender_password)
            smtp.send_message(email_message)

        return True

    except smtplib.SMTPAuthenticationError as e:
        print(f"Email authentication failed: {e}")
        return False
    except smtplib.SMTPException as e:
        print(f"SMTP error while sending email: {e}")
        return False
    except ValueError as e:
        print(f"Email configuration/input error: {e}")
        return False
    except Exception as e:
        print(f"Unexpected email sending error: {e}")
        return False


def send_sms_alert(message):
    """
    Send an SMS alert using Twilio.

    Environment variables used:
    - TWILIO_ACCOUNT_SID
    - TWILIO_AUTH_TOKEN
    - TWILIO_PHONE_NUMBER or TWILIO_FROM_PHONE_NUMBER
    - ALERT_PHONE_NUMBER or TWILIO_TO_PHONE_NUMBER

    Args:
        message: SMS body text.

    Returns:
        bool: True if sent successfully, otherwise False.
    """
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    from_phone = os.getenv("TWILIO_PHONE_NUMBER") or os.getenv("TWILIO_FROM_PHONE_NUMBER")
    to_phone = os.getenv("ALERT_PHONE_NUMBER") or os.getenv("TWILIO_TO_PHONE_NUMBER")

    try:
        if message is None or not str(message).strip():
            raise ValueError("message is required.")

        if not account_sid or not auth_token or not from_phone or not to_phone:
            raise ValueError(
                "Missing Twilio configuration. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, "
                "TWILIO_PHONE_NUMBER (or TWILIO_FROM_PHONE_NUMBER), and ALERT_PHONE_NUMBER "
                "(or TWILIO_TO_PHONE_NUMBER)."
            )

        try:
            twilio_rest = __import__("twilio.rest", fromlist=["Client"])
            Client = twilio_rest.Client
        except ImportError:
            print("Twilio SDK is not installed. Run: pip install twilio")
            return False

        client = Client(account_sid, auth_token)
        client.messages.create(
            body=str(message),
            from_=from_phone,
            to=to_phone,
        )

        return True

    except ValueError as e:
        print(f"SMS configuration/input error: {e}")
        return False
    except Exception as e:
        # Twilio API and transport errors are surfaced here.
        print(f"Unexpected SMS sending error: {e}")
        return False


def analyze_description(text: str) -> dict:
    """
    Analyze incident description text using spaCy and return inferred incident type
    and mentioned people count.

    Detects keyword-based incident types: fire, flood, accident, earthquake.

    Args:
        text: Raw incident description

    Returns:
        dict: {
            "type": <predicted_type>,
            "people_affected": <int>
        }
    """
    if not text:
        return {"type": "accident", "people_affected": 1}

    doc = _nlp(text)
    lowered_text = text.lower()

    # Score incident types by keyword hits.
    type_scores = {k: 0 for k in INCIDENT_KEYWORDS.keys()}
    for token in doc:
        token_text = token.text.lower()
        for incident_type, keywords in INCIDENT_KEYWORDS.items():
            if token_text in keywords:
                type_scores[incident_type] += 1

    # Use highest score; default to accident if no keyword matched.
    predicted_type = "accident"
    best_score = 0
    for incident_type, score in type_scores.items():
        if score > best_score:
            predicted_type = incident_type
            best_score = score

    # Extract numeric mention for people affected.
    # First preference: explicit digit mentions like "12 people", "20 injured".
    people_affected = None
    pattern = re.search(
        r"\b(\d+)\s+(people|persons|person|victims|injured|affected|casualties)\b",
        lowered_text,
    )
    if pattern:
        people_affected = int(pattern.group(1))
    else:
        # Fallback: look for number-like tokens near relevant context words.
        context_words = {"people", "persons", "person", "victims", "injured", "affected", "casualties"}
        tokens = [t.text.lower() for t in doc]
        for i, token_text in enumerate(tokens):
            value = None
            if token_text.isdigit():
                value = int(token_text)
            else:
                value = _word_to_number(token_text)

            if value is None:
                continue

            window = set(tokens[max(0, i - 2): min(len(tokens), i + 3)])
            if window & context_words:
                people_affected = value
                break

    # Final fallback if no people count mentioned.
    if people_affected is None:
        people_affected = 1

    people_affected = max(0, int(people_affected))
    return {"type": predicted_type, "people_affected": people_affected}

def _train_model():
    """Train the RandomForestClassifier with the provided dataset."""
    global _model
    
    # Encode categorical features
    incident_encoded = _incident_encoder.fit_transform(TRAINING_DATA['incident_type'])
    location_encoded = _location_encoder.fit_transform(TRAINING_DATA['location_type'])
    time_encoded = _time_encoder.fit_transform(TRAINING_DATA['time_of_day'])
    severity_encoded = _severity_encoder.fit_transform(TRAINING_DATA['severity'])
    
    # Prepare feature matrix
    X = np.column_stack([
        incident_encoded,
        location_encoded,
        TRAINING_DATA['people_affected'],
        time_encoded
    ])
    
    y = severity_encoded
    
    # Train RandomForestClassifier
    _model = RandomForestClassifier(n_estimators=50, random_state=42, max_depth=10)
    _model.fit(X, y)

def predict_severity(input_data: dict) -> str:
    """
    Predict crisis severity based on incident characteristics.
    
    Args:
        input_data (dict): Dictionary with keys:
            - incident_type (str): Type of incident (e.g., 'fire', 'medical', 'accident')
            - location_type (str): 'urban' or 'rural'
            - people_affected (int): Number of people affected
            - time_of_day (str): 'day' or 'night'
    
    Returns:
        str: Predicted severity label ('LOW', 'MEDIUM', or 'HIGH') - ALWAYS A STRING, NEVER A DICT
    """
    global _model
    
    # Train model on first use
    if _model is None:
        _train_model()
    
    try:
        # Extract and validate inputs
        incident_type = str(input_data.get('incident_type', 'accident')).lower()
        location_type = str(input_data.get('location_type', 'urban')).lower()
        people_affected = int(input_data.get('people_affected', 1))
        time_of_day = str(input_data.get('time_of_day', 'day')).lower()
        
        # Encode inputs using fitted encoders
        incident_encoded = _incident_encoder.transform([incident_type])[0]
        location_encoded = _location_encoder.transform([location_type])[0]
        time_encoded = _time_encoder.transform([time_of_day])[0]
        
        # Prepare feature vector
        X_input = np.array([[
            incident_encoded,
            location_encoded,
            people_affected,
            time_encoded
        ]])
        
        # Make prediction
        prediction_encoded = _model.predict(X_input)[0]
        prediction = _severity_encoder.inverse_transform([prediction_encoded])[0]
        
        # Ensure prediction is a string (not a dict, not any other type)
        severity_str = str(prediction).strip().upper()
        
        # Validate that it's one of the expected values
        valid_severities = ['LOW', 'MEDIUM', 'HIGH']
        if severity_str not in valid_severities:
            print(f"Warning: Unexpected severity from model: {severity_str}, using LOW")
            return "LOW"
        
        # ALWAYS return just the string label, NEVER a dictionary
        return severity_str
        
    except Exception as e:
        print(f"Prediction error: {e}")
        # Fallback prediction based on people affected
        if people_affected > 100:
            return "HIGH"
        elif people_affected > 10:
            return "MEDIUM"
        else:
            return "LOW"


def predict_resolution_time(data: dict) -> int:
    """
    Predict incident resolution time in minutes.

    Features:
    - severity: LOW, MEDIUM, HIGH
    - people_affected: integer
    - location_type: urban/rural
    - incident_type: fire/flood/accident/earthquake/medical/hazmat, etc.

    Args:
        data: Input dictionary with model features.

    Returns:
        int: Estimated resolution time in minutes.
    """
    global _resolution_time_model

    if _resolution_time_model is None:
        _train_resolution_time_model()

    try:
        severity = str(data.get("severity", "MEDIUM")).strip().upper()
        location_type = str(data.get("location_type", "urban")).strip().lower()
        incident_type = str(data.get("incident_type", "accident")).strip().lower()
        people_affected = max(0, int(data.get("people_affected", 1)))

        # Guard unknown categories by mapping to known defaults.
        known_severity = set(_rt_severity_encoder.classes_)
        known_locations = set(_rt_location_encoder.classes_)
        known_incidents = set(_rt_incident_encoder.classes_)

        if severity not in known_severity:
            severity = "MEDIUM"
        if location_type not in known_locations:
            location_type = "urban"
        if incident_type not in known_incidents:
            incident_type = "accident"

        severity_encoded = _rt_severity_encoder.transform([severity])[0]
        location_encoded = _rt_location_encoder.transform([location_type])[0]
        incident_encoded = _rt_incident_encoder.transform([incident_type])[0]

        X_input = np.array([[
            severity_encoded,
            people_affected,
            location_encoded,
            incident_encoded,
        ]])

        prediction = float(_resolution_time_model.predict(X_input)[0])
        prediction = max(5.0, min(360.0, prediction))
        return int(round(prediction))

    except Exception as e:
        print(f"Resolution time prediction error: {e}")
        # Fallback heuristic.
        severity_weight = {
            "LOW": 20,
            "MEDIUM": 45,
            "HIGH": 90,
        }
        severity = str(data.get("severity", "MEDIUM")).strip().upper()
        base = severity_weight.get(severity, 45)
        people = max(0, int(data.get("people_affected", 1)))
        return int(min(360, max(5, base + (people // 5))))


def extract_severity(severity_value):
    """
    Extract and validate severity value. Handles cases where severity might be:
    - A string: "HIGH", "MEDIUM", "LOW", "high", "critical", etc.
    - A dictionary: {"severity": "HIGH"}
    - Invalid types: returns fallback "low"
    
    Args:
        severity_value: Raw severity value (string, dict, or invalid)
    
    Returns:
        str: Normalized severity string in lowercase ("high", "medium", "low", or "critical")
    """
    try:
        # If it's a dictionary, extract the 'severity' key
        if isinstance(severity_value, dict):
            severity_str = severity_value.get('severity', 'low')
        else:
            severity_str = str(severity_value)
        
        # Normalize to lowercase and strip whitespace
        severity_str = severity_str.strip().lower()
        
        # Validate: only allow known severity levels
        valid_severities = ['low', 'medium', 'high', 'critical']
        if severity_str not in valid_severities:
            print(f"Warning: Invalid severity '{severity_str}', using 'low' as fallback")
            return 'low'
        
        return severity_str
        
    except Exception as e:
        print(f"Error extracting severity: {e}, using 'low' as fallback")
        return 'low'


def calculate_risk_score_and_response_time(description: str, category: str, severity: str):
    """
    Use AI to calculate risk score (0-1) and estimated response time (minutes).
    
    Args:
        description: Incident description
        category: Incident category
        severity: AI-predicted severity (can be string, dict, or invalid - will be validated)
    
    Returns:
        Tuple of (risk_score: float, estimated_response_time: int)
    """
    
    # Extract and validate severity
    normalized_severity = extract_severity(severity)
    
    prompt = f"""
You are an emergency response AI system. Analyze this incident and return a JSON response.

Incident Details:
- Description: {description}
- Category: {category}
- Severity: {normalized_severity}

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
        # Use normalized_severity for the mapping
        return severity_mapping.get(normalized_severity, (0.5, 15))
