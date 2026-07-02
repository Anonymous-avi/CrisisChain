from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # allow all origins (for development)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import json

DATA_FILE = "incidents.json"

def load_incidents():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r") as f:
        return json.load(f)

def save_incidents(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=4)




from fastapi import Depends, FastAPI
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from fastapi import WebSocket, WebSocketDisconnect
from typing import List
import asyncio
from datetime import datetime, timedelta
import logging
from google import genai
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from ai_utils import calculate_risk_score_and_response_time, predict_severity as predict_crisis_severity, extract_severity, analyze_description, predict_resolution_time, send_email_alert, send_sms_alert

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crisischain.alerts")

def predict_severity(description: str):
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=f"""
Classify the severity of this emergency into:
low, medium, high, critical.

Emergency: {description}

Only return one word.
"""
    )

    return response.text.strip().lower()


import math

def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371  # Earth radius in km

    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )

    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def auto_assign_responder(db: Session, incident):
    responders = db.query(models.User).filter(
        models.User.role == "responder",
        models.User.status == "available"
    ).all()

    matching_responders = [
        responder for responder in responders
        if responder.skill == incident.category
    ]

    if not matching_responders:
        return None

    scored_responders = []

    for responder in matching_responders:
        distance = calculate_distance(
            incident.latitude,
            incident.longitude,
            responder.latitude,
            responder.longitude
        )

        score = (
            (1 / (distance + 1)) * 0.5 +
            (incident.risk_score) * 0.3 +
            (1 - responder.current_load) * 0.2
        )

        scored_responders.append((score, responder))

    scored_responders.sort(key=lambda item: item[0], reverse=True)
    assigned_responder = scored_responders[0][1]

    assigned_responder.status = "busy"
    assigned_responder.current_load += 1
    incident.status = "in_progress"
    incident.assigned_responder_id = assigned_responder.id

    return assigned_responder


import models
from database import Base, SessionLocal, engine


def ensure_incident_priority_column():
    """Add incidents.priority_score column if it does not exist (SQLite-safe migration)."""
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(incidents);"))
        columns = {row[1] for row in result.fetchall()}
        if "priority_score" not in columns:
            conn.execute(text("ALTER TABLE incidents ADD COLUMN priority_score FLOAT NOT NULL DEFAULT 0.0;"))
            conn.commit()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Create database tables
Base.metadata.create_all(bind=engine)
ensure_incident_priority_column()


class UserCreate(BaseModel):
    name: str
    role: str
    latitude: float
    longitude: float

class IncidentCreate(BaseModel):
    description: str
    category: str
    latitude: float
    longitude: float
    severity: str | None = None

class SeverityPredictionRequest(BaseModel):
    type: str
    location_type: str
    people_affected: int
    time_of_day: str

class AnalyzeDescriptionRequest(BaseModel):
    text: str

class ResolutionTimePredictionRequest(BaseModel):
    type: str
    severity: str
    people_affected: int
    location_type: str

class IncidentResponse(BaseModel):
    id: int
    description: str
    category: str
    severity: str
    latitude: float
    longitude: float
    status: str
    risk_score: float
    priority_score: float
    escalation_risk: float
    is_likely_to_escalate: bool
    eta: int
    estimated_response_time: int

    class Config:
        orm_mode = True


@app.get("/")
def read_root():
    return {"message": "CrisisChain Backend Running 🚀"}


@app.post("/predict-severity")
def predict_severity_endpoint(payload: SeverityPredictionRequest):
    """
    Predict crisis severity based on incident characteristics.
    
    Input fields:
    - type: Incident type (e.g., 'fire', 'medical', 'accident')
    - location_type: 'urban' or 'rural'
    - people_affected: Number of people affected (int)
    - time_of_day: 'day' or 'night'
    
    Returns: JSON with predicted severity ('LOW', 'MEDIUM', 'HIGH')
    """
    try:
        # Prepare input for the ML model
        input_data = {
            'incident_type': payload.type,
            'location_type': payload.location_type,
            'people_affected': payload.people_affected,
            'time_of_day': payload.time_of_day
        }
        
        # Call the predict_severity function from ai_utils
        severity = predict_crisis_severity(input_data)
        
        # Validate and normalize severity (handles dict/invalid types)
        validated_severity = extract_severity(severity)
        # Convert to uppercase for consistency with ML output
        validated_severity = validated_severity.upper()
        
        return {
            "severity": validated_severity,
            "input": {
                "type": payload.type,
                "location_type": payload.location_type,
                "people_affected": payload.people_affected,
                "time_of_day": payload.time_of_day
            }
        }
    except Exception as e:
        print(f"Error in predict_severity_endpoint: {e}")
        return {
            "error": str(e),
            "severity": "HIGH"  # Default to HIGH on error
        }


@app.post("/analyze-description")
def analyze_description_endpoint(payload: AnalyzeDescriptionRequest):
    """
    Analyze free-text incident description and extract inferred incident type
    and people affected count.

    Input fields:
    - text: Incident description text

    Returns:
    - type: detected incident type
    - people_affected: extracted people affected count
    """
    try:
        result = analyze_description(payload.text)
        return {
            "type": result.get("type", "accident"),
            "people_affected": int(result.get("people_affected", 1)),
        }
    except Exception as e:
        print(f"Error in analyze_description_endpoint: {e}")
        return {
            "type": "accident",
            "people_affected": 1,
            "error": str(e),
        }


@app.post("/predict-resolution-time")
def predict_resolution_time_endpoint(payload: ResolutionTimePredictionRequest):
    """
    Predict incident resolution time (minutes) from structured incident features.

    Input fields:
    - type: incident type
    - severity: LOW / MEDIUM / HIGH
    - people_affected: integer
    - location_type: urban / rural

    Returns:
    - estimated_time_minutes: predicted resolution time in minutes
    """
    try:
        estimated_minutes = predict_resolution_time({
            "incident_type": payload.type,
            "severity": payload.severity,
            "people_affected": payload.people_affected,
            "location_type": payload.location_type,
        })
        return {
            "estimated_time_minutes": int(estimated_minutes),
            "input": {
                "type": payload.type,
                "severity": payload.severity,
                "people_affected": payload.people_affected,
                "location_type": payload.location_type,
            }
        }
    except Exception as e:
        print(f"Error in predict_resolution_time_endpoint: {e}")
        return {
            "estimated_time_minutes": 45,
            "error": str(e),
        }


@app.post("/register-user")
def register_user(payload: UserCreate, db: Session = Depends(get_db)):
    new_user = models.User(
        name=payload.name,
        role=payload.role,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": "User registered", "user_id": new_user.id}



@app.post("/create-incident")
async def create_incident(payload: IncidentCreate, db: Session = Depends(get_db)):
    # Use severity from request body when provided. If missing/empty, fallback to LOW.
    ai_severity_raw = payload.severity
    if ai_severity_raw is None or str(ai_severity_raw).strip() == "":
        ai_severity_raw = "LOW"

    # Validate and normalize severity (handles dict/invalid types)
    ai_severity = extract_severity(ai_severity_raw)

    # Calculate AI-based risk score
    risk_score, _ = calculate_risk_score_and_response_time(
        payload.description,
        payload.category,
        ai_severity
    )

    # Estimate incident context from description for downstream predictions.
    description_analysis = analyze_description(payload.description)
    people_affected = max(0, int(description_analysis.get("people_affected", 1)))
    location_type = "urban"

    # Predict ETA (resolution time in minutes) using the regression model.
    eta_minutes = predict_resolution_time({
        "incident_type": payload.category,
        "severity": ai_severity.upper(),
        "people_affected": people_affected,
        "location_type": location_type,
    })

    escalation_risk, is_likely_to_escalate = predict_escalation(risk_score, ai_severity)
    priority_score = calculate_priority(
        ai_severity,
        risk_score,
        people_affected=people_affected,
        time_elapsed_minutes=0,
    )

    # Trigger alerts for critical incidents.
    alert_trigger_reasons = []
    if priority_score > 0.8:
        alert_trigger_reasons.append(f"priority_score({priority_score}) > 0.8")
    if ai_severity.upper() == "HIGH":
        alert_trigger_reasons.append("severity == HIGH")

    if alert_trigger_reasons:
        incident_context = {
            "description": payload.description,
            "category": payload.category,
            "severity": ai_severity.upper(),
            "priority_score": round(priority_score, 2),
            "risk_score": round(risk_score, 2),
            "people_affected": people_affected,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "eta_minutes": eta_minutes,
        }

        logger.info(
            "ALERT_TRIGGERED | reasons=%s | incident=%s",
            "; ".join(alert_trigger_reasons),
            json.dumps(incident_context),
        )

        incident_alert_message = (
            f"Incident Alert\n"
            f"Description: {payload.description}\n"
            f"Category: {payload.category}\n"
            f"Severity: {ai_severity.upper()}\n"
            f"Priority Score: {priority_score}\n"
            f"Risk Score: {round(risk_score, 2)}\n"
            f"People Affected: {people_affected}\n"
            f"Location: ({payload.latitude}, {payload.longitude})\n"
            f"ETA (minutes): {eta_minutes}"
        )

        alert_to_email = os.getenv("ALERT_TO_EMAIL") or os.getenv("EMAIL_TO")
        email_sent = send_email_alert(
            alert_to_email,
            f"CrisisChain Incident Alert - {ai_severity.upper()}",
            incident_alert_message,
        )
        sms_sent = send_sms_alert(incident_alert_message)

        if email_sent and sms_sent:
            logger.info("ALERT_DISPATCH_RESULT | email_sent=True | sms_sent=True")
        elif email_sent and not sms_sent:
            logger.warning("ALERT_DISPATCH_RESULT | email_sent=True | sms_sent=False | status=partial_failure")
        elif not email_sent and sms_sent:
            logger.warning("ALERT_DISPATCH_RESULT | email_sent=False | sms_sent=True | status=partial_failure")
        else:
            logger.error("ALERT_DISPATCH_RESULT | email_sent=False | sms_sent=False | status=failed")

    # Set escalation deadline
    now = datetime.utcnow()
    if is_likely_to_escalate:
        escalation_deadline = now + timedelta(minutes=5)
    else:
        escalation_deadline = now + timedelta(minutes=10)

    # Create new incident
    new_incident = models.Incident(
        description=payload.description,
        category=payload.category,
        severity=ai_severity,
        latitude=payload.latitude,
        longitude=payload.longitude,
        status="pending",
        risk_score=risk_score,
        priority_score=priority_score,
        escalation_risk=escalation_risk,
        is_likely_to_escalate=is_likely_to_escalate,
        escalation_deadline=escalation_deadline,
        estimated_response_time=eta_minutes
    )

    db.add(new_incident)
    db.commit()
    db.refresh(new_incident)

    assigned_responder = auto_assign_responder(db, new_incident)
    if assigned_responder:
        db.commit()
        db.refresh(new_incident)

    # Fetch responders
    responders = db.query(models.User).filter(models.User.role == "responder").all()

    scored_responders = []

    for responder in responders:
        distance = calculate_distance(
            payload.latitude,
            payload.longitude,
            responder.latitude,
            responder.longitude
        )

        normalized_distance = min(distance / 10, 1)
        skill_match = 1 if responder.skill == payload.category else 0
        trust_factor = responder.trust_score / 100
        load_penalty = responder.current_load * 0.1

        score = (
            (1 - normalized_distance) * 0.4
            + skill_match * 0.3
            + trust_factor * 0.2
            - load_penalty
        )
        score = max(0, min(1, score))

        scored_responders.append({
            "id": responder.id,
            "name": responder.name,
            "distance_km": round(distance, 2),
            "score": round(score, 2)
        })

    scored_responders.sort(key=lambda x: x["score"], reverse=True)

    top_responders = scored_responders[:3]

    # Calculate escalation countdown
    escalation_seconds_remaining = int((new_incident.escalation_deadline - datetime.utcnow()).total_seconds()) if new_incident.escalation_deadline else 0

    incident_payload = {
        "id": new_incident.id,
        "description": new_incident.description,
        "category": new_incident.category,
        "severity": new_incident.severity,
        "latitude": new_incident.latitude,
        "longitude": new_incident.longitude,
        "status": new_incident.status,
        "risk_score": round(new_incident.risk_score, 2),
        "escalation_risk": round(new_incident.escalation_risk, 2),
        "is_likely_to_escalate": new_incident.is_likely_to_escalate,
        "priority_score": round(priority_score, 2),
        "eta": new_incident.estimated_response_time,
        "estimated_response_time": new_incident.estimated_response_time,
        "escalation_seconds_remaining": escalation_seconds_remaining,
        "created_at": new_incident.created_at.isoformat() if new_incident.created_at else None
    }

    # Broadcast incident to connected clients
    await manager.broadcast({
        "type": "new_incident",
        "incident": incident_payload,
        "assigned_responders": top_responders,
        "priority_score": round(priority_score, 2)
    })

    return {
        "message": "Incident created",
        "incident_id": new_incident.id,
        "risk_score": round(risk_score, 2),
        "eta": eta_minutes,
        "estimated_response_time": eta_minutes,
        "assigned_responders": top_responders
    }

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print("WebSocket connected. Total:", len(self.active_connections))

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        print("WebSocket disconnected. Total:", len(self.active_connections))

    async def broadcast(self, message: dict):
        print("Broadcasting to:", len(self.active_connections))
        for connection in self.active_connections:
            await connection.send_json(message)


manager = ConnectionManager()

def escalate_severity(severity):
    # Validate and normalize severity
    normalized_severity = extract_severity(severity)
    
    severity_order = ["low", "medium", "high", "critical"]
    if normalized_severity not in severity_order:
        return "critical"

    current_index = severity_order.index(normalized_severity)
    next_index = min(current_index + 1, len(severity_order) - 1)
    return severity_order[next_index]


async def escalation_monitor():
    while True:
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            incidents = db.query(models.Incident).filter(
                models.Incident.escalation_deadline.isnot(None),
                models.Incident.escalation_deadline <= now,
                models.Incident.status != "resolved",
                models.Incident.status != "escalated"
            ).all()

            for incident in incidents:
                new_severity = escalate_severity(incident.severity)
                escalation_risk, is_likely_to_escalate = predict_escalation(
                    incident.risk_score,
                    new_severity
                )
                elapsed_minutes = 0
                if incident.created_at:
                    elapsed_minutes = max(
                        0,
                        int((datetime.utcnow() - incident.created_at).total_seconds() / 60),
                    )
                priority_score = calculate_priority(
                    new_severity,
                    incident.risk_score,
                    people_affected=1,
                    time_elapsed_minutes=elapsed_minutes,
                )

                incident.status = "escalated"
                incident.severity = new_severity
                incident.priority_score = priority_score
                incident.escalation_risk = escalation_risk
                incident.is_likely_to_escalate = is_likely_to_escalate
                incident.escalation_deadline = None

                db.commit()
                db.refresh(incident)

                incident_payload = {
                    "id": incident.id,
                    "description": incident.description,
                    "category": incident.category,
                    "severity": incident.severity,
                    "latitude": incident.latitude,
                    "longitude": incident.longitude,
                    "status": incident.status,
                    "risk_score": round(incident.risk_score, 2),
                    "escalation_risk": round(incident.escalation_risk, 2),
                    "is_likely_to_escalate": incident.is_likely_to_escalate,
                    "priority_score": priority_score,
                    "eta": incident.estimated_response_time,
                    "estimated_response_time": incident.estimated_response_time,
                    "escalation_seconds_remaining": 0,
                    "created_at": incident.created_at.isoformat() if incident.created_at else None
                }

                await manager.broadcast({
                    "type": "incident_escalated",
                    "incident": incident_payload
                })
        except Exception as e:
            print("Escalation monitor error:", e)
        finally:
            db.close()

        await asyncio.sleep(1)


@app.on_event("startup")
async def start_escalation_monitor():
    asyncio.create_task(escalation_monitor())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

class AcceptIncident(BaseModel):
    incident_id: int
    responder_id: int

@app.post("/accept-incident")
async def accept_incident(payload: AcceptIncident, db: Session = Depends(get_db)):

    incident = db.query(models.Incident).filter(
        models.Incident.id == payload.incident_id
    ).first()

    if not incident:
        return {"error": "Incident not found"}

    incident.status = "in_progress"
    db.commit()

    await manager.broadcast({
        "type": "incident_accepted",
        "incident_id": payload.incident_id,
        "responder_id": payload.responder_id,
        "status": "in_progress"
    })

    return {"message": "Incident accepted"}

class ResolveIncident(BaseModel):
    incident_id: int

@app.post("/resolve-incident")
async def resolve_incident(payload: ResolveIncident, db: Session = Depends(get_db)):

    incident = db.query(models.Incident).filter(
        models.Incident.id == payload.incident_id
    ).first()

    if not incident:
        return {"error": "Incident not found"}

    incident.status = "resolved"
    db.commit()

    await manager.broadcast({
        "type": "incident_resolved",
        "incident_id": payload.incident_id,
        "status": "resolved"
    })

    return {"message": "Incident resolved"}

@app.get("/test-ai")
async def test_ai():
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents="Say hello in one sentence."
    )

    return {
        "reply": response.text
    }

@app.get("/incidents", response_model=List[IncidentResponse])
def get_incidents(db: Session = Depends(get_db)):
    incidents = db.query(models.Incident).all()

    return [
        {
            "id": i.id,
            "description": i.description,
            "category": i.category,
            "severity": i.severity,
            "latitude": i.latitude,
            "longitude": i.longitude,
            "status": i.status,
            "risk_score": i.risk_score,
            "priority_score": i.priority_score,
            "escalation_risk": i.escalation_risk,
            "is_likely_to_escalate": i.is_likely_to_escalate,
            "eta": i.estimated_response_time,
            "estimated_response_time": i.estimated_response_time,
        }
        for i in incidents
    ]
def predict_escalation(risk_score, severity):
    # Validate and normalize severity
    normalized_severity = extract_severity(severity)
    
    severity_weight = {
        "low": 0.2,
        "medium": 0.4,
        "high": 0.7,
        "critical": 0.9
    }

    escalation_score = (risk_score * 0.7) + severity_weight.get(normalized_severity, 0.5)

    return escalation_score, escalation_score > 1.0


def calculate_priority(severity, risk_score, people_affected, time_elapsed_minutes):
    """
    Calculate a normalized priority score between 0 and 1.

    Args:
        severity: Severity label (LOW, MEDIUM, HIGH)
        risk_score: Risk score as float (expected 0-1)
        people_affected: Number of affected people
        time_elapsed_minutes: Time elapsed since incident creation in minutes

    Returns:
        float: Priority score in range [0.0, 1.0]
    """
    normalized_severity = extract_severity(severity)
    severity_numeric = {
        "low": 1,
        "medium": 2,
        "high": 3,
        "critical": 3,
    }.get(normalized_severity, 1)

    # LOW=1, MEDIUM=2, HIGH=3 mapped to 0-1
    severity_norm = (severity_numeric - 1) / 2
    risk_norm = max(0.0, min(1.0, float(risk_score)))

    # Normalize people/time with practical caps
    people_norm = max(0.0, min(1.0, float(people_affected) / 500.0))
    time_norm = max(0.0, min(1.0, float(time_elapsed_minutes) / 120.0))

    score = (
        severity_norm * 0.35
        + risk_norm * 0.40
        + people_norm * 0.15
        + time_norm * 0.10
    )
    return round(max(0.0, min(1.0, score)), 2)


