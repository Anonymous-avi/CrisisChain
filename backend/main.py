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
from fastapi import WebSocket, WebSocketDisconnect
from typing import List
import asyncio
from datetime import datetime, timedelta
from google import genai
import os

from ai_utils import calculate_risk_score_and_response_time

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

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

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Create database tables
Base.metadata.create_all(bind=engine)

@app.get("/")
def read_root():
    return {"message": "CrisisChain Backend Running 🚀"}


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

class IncidentResponse(BaseModel):
    id: int
    description: str
    category: str
    severity: str
    latitude: float
    longitude: float
    status: str
    risk_score: float
    escalation_risk: float
    is_likely_to_escalate: bool
    estimated_response_time: int

    class Config:
        orm_mode = True
   


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
    try:
        ai_severity = predict_severity(payload.description)
    except Exception as e:
        print("AI failed, using default severity:", e)
        ai_severity = "high"  # fallback

    # Calculate AI-based risk score and response time
    risk_score, response_time = calculate_risk_score_and_response_time(
        payload.description,
        payload.category,
        ai_severity
    )
    escalation_risk, is_likely_to_escalate = predict_escalation(risk_score, ai_severity)
    priority_score = (
        risk_score * 0.6 +
        escalation_risk * 0.3 +
        (0.1 if is_likely_to_escalate else 0)
    )
    priority_score = round(priority_score, 2)

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
        escalation_risk=escalation_risk,
        is_likely_to_escalate=is_likely_to_escalate,
        escalation_deadline=escalation_deadline,
        estimated_response_time=response_time
    )

    db.add(new_incident)
    db.commit()
    db.refresh(new_incident)

    assigned_responder = auto_assign_responder(db, new_incident)
    if assigned_responder:
        db.commit()
        db.refresh(new_incident)
    new_incident.priority_score = priority_score

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
        "estimated_response_time": response_time,
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
            "escalation_risk": i.escalation_risk,
            "is_likely_to_escalate": i.is_likely_to_escalate,
            "estimated_response_time": i.estimated_response_time,
        }
        for i in incidents
    ]
def predict_escalation(risk_score, severity):
    severity_weight = {
        "low": 0.2,
        "medium": 0.4,
        "high": 0.7,
        "critical": 0.9
    }

    escalation_score = (risk_score * 0.7) + severity_weight.get(severity, 0.5)

    return escalation_score, escalation_score > 1.0


