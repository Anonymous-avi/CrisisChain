from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.sql import func

from database import Base


class User(Base):
	__tablename__ = "users"

	id = Column(Integer, primary_key=True, index=True)
	name = Column(String, nullable=False)
	role = Column(String, nullable=False)
	latitude = Column(Float, nullable=False)
	longitude = Column(Float, nullable=False)
	trust_score = Column(Integer, default=0, nullable=False)
	status = Column(String, default="available", nullable=False)
	skill = Column(String, nullable=True)
	current_load = Column(Integer, default=0, nullable=False)


class Incident(Base):
	__tablename__ = "incidents"

	id = Column(Integer, primary_key=True, index=True)
	description = Column(String, nullable=False)
	category = Column(String, nullable=False)
	severity = Column(String, nullable=False)
	latitude = Column(Float, nullable=False)
	longitude = Column(Float, nullable=False)
	status = Column(String, default="pending", nullable=False)
	assigned_responder_id = Column(Integer, ForeignKey("users.id"), nullable=True)
	risk_score = Column(Float, default=0.0, nullable=False)
	escalation_risk = Column(Float, default=0.0, nullable=False)
	is_likely_to_escalate = Column(Boolean, default=False, nullable=False)
	escalation_deadline = Column(DateTime(timezone=True), nullable=True)
	estimated_response_time = Column(Integer, default=0, nullable=False)
	created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
