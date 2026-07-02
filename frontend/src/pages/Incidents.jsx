import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ALERT_COOLDOWN_MS = 10000;

export default function Incidents() {
  const [incidents, setIncidents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortByRisk, setSortByRisk] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [predictedSeverity, setPredictedSeverity] = useState(null);
  const [isLoadingSeverity, setIsLoadingSeverity] = useState(false);
  const [isAnalyzingDescription, setIsAnalyzingDescription] = useState(false);
  const alertToneDataUriRef = useRef("");
  const knownCriticalIdsRef = useRef(new Set());
  const lastAlertAtRef = useRef(0);
  const incidentLastAlertAtRef = useRef(new Map());
  const pendingCriticalAlertIdsRef = useRef(new Set());
  const [formData, setFormData] = useState({
    type: "fire",
    location_type: "urban",
    people_affected: 1,
    time_of_day: "day",
    severity: "",
    description: "",
    category: "fire",
    latitude: 28.6139,
    longitude: 77.209
  });

  useEffect(() => {
    if (!showCreateForm) {
      setIsAnalyzingDescription(false);
      return;
    }

    const descriptionText = formData.description.trim();
    if (descriptionText.length < 3) {
      setIsAnalyzingDescription(false);
      return;
    }

    setIsAnalyzingDescription(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch("http://127.0.0.1:8000/analyze-description", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: descriptionText }),
          signal: controller.signal,
        });

        const data = await response.json();
        if (!response.ok) {
          return;
        }

        const detectedType = String(data.type || "").toLowerCase();
        const detectedPeople = Number(data.people_affected);

        setFormData(prev => ({
          ...prev,
          type: detectedType || prev.type,
          category: detectedType || prev.category,
          people_affected: Number.isFinite(detectedPeople) ? Math.max(0, detectedPeople) : prev.people_affected,
          severity: "",
        }));

        // Type/people changes can invalidate previous severity prediction.
        setPredictedSeverity(null);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Error analyzing description:", err);
        }
      } finally {
        setIsAnalyzingDescription(false);
      }
    }, 500);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
      setIsAnalyzingDescription(false);
    };
  }, [formData.description, showCreateForm]);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/incidents")
      .then(res => res.json())
      .then(data => setIncidents(
        data.map(incident => ({
          ...incident,
          eta: incident.eta,
          escalation_seconds_remaining: incident.escalation_seconds_remaining ?? 0
        }))
      ))
      .catch(err => console.error(err));
  }, []);

    // 🔥 Real-time WebSocket sync
  useEffect(() => {
    const socket = new WebSocket("ws://127.0.0.1:8000/ws");

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "new_incident") {
        const incidentData = data.incident ?? data;
        setIncidents(prev => [
          ...prev,
          {
            id: incidentData.id ?? data.incident_id,
            description: incidentData.description,
            latitude: incidentData.latitude,
            longitude: incidentData.longitude,
            severity: incidentData.severity,
            status: "pending",
            risk_score: incidentData.risk_score,
            priority_score: incidentData.priority_score ?? data.priority_score ?? 0,
            eta: incidentData.eta,
            escalation_seconds_remaining: incidentData.escalation_seconds_remaining ?? data.escalation_seconds_remaining ?? 0
          }
        ]);
      }

      if (data.type === "incident_accepted") {
        setIncidents(prev =>
          prev.map(i =>
            i.id === data.incident_id
              ? { ...i, status: "in_progress" }
              : i
          )
        );
      }

      if (data.type === "incident_resolved") {
        setIncidents(prev =>
          prev.map(i =>
            i.id === data.incident_id
              ? { ...i, status: "resolved" }
              : i
          )
        );
      }
    };

    return () => socket.close();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setIncidents(prev => prev.map(incident => {
        const remaining = Number(incident.escalation_seconds_remaining);
        if (!Number.isFinite(remaining) || remaining <= 0) {
          return remaining === 0 ? incident : { ...incident, escalation_seconds_remaining: 0 };
        }

        const nextRemaining = Math.max(0, remaining - 1);
        return nextRemaining === remaining
          ? incident
          : { ...incident, escalation_seconds_remaining: nextRemaining };
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const isCriticalIncident = (incident) => {
    const priorityScore = Number(incident.priority_score) || 0;
    const normalizedSeverity = String(incident.severity || "").toUpperCase();
    return priorityScore > 0.8 || normalizedSeverity === "HIGH" || normalizedSeverity === "CRITICAL";
  };

  const buildAlertToneDataUri = useCallback(() => {
    const sampleRate = 44100;
    const durationSeconds = 0.22;
    const frequencyHz = 990;
    const sampleCount = Math.floor(sampleRate * durationSeconds);
    const bytesPerSample = 2;
    const dataSize = sampleCount * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, value) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < sampleCount; i += 1) {
      const t = i / sampleRate;
      const fade = 1 - (i / sampleCount);
      const sample = Math.sin(2 * Math.PI * frequencyHz * t) * 0.32 * fade;
      view.setInt16(44 + i * bytesPerSample, Math.max(-1, Math.min(1, sample)) * 32767, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:audio/wav;base64,${window.btoa(binary)}`;
  }, []);

  const playCriticalIncidentAlert = useCallback(() => {
    try {
      if (!alertToneDataUriRef.current) {
        alertToneDataUriRef.current = buildAlertToneDataUri();
      }
      const alertAudio = new Audio(alertToneDataUriRef.current);
      alertAudio.volume = 0.9;
      alertAudio.play().catch((err) => {
        console.warn("Critical alert sound was blocked by browser autoplay policy:", err);
      });
    } catch (err) {
      console.warn("Failed to play critical incident alert sound:", err);
    }
  }, [buildAlertToneDataUri]);

  useEffect(() => {
    const now = Date.now();
    const nextCriticalIds = new Set(
      incidents
        .filter(isCriticalIncident)
        .map(incident => incident.id)
    );

    const pendingIds = pendingCriticalAlertIdsRef.current;

    const activeIncidentIds = new Set(incidents.map((incident) => incident.id));
    incidentLastAlertAtRef.current.forEach((_value, id) => {
      if (!activeIncidentIds.has(id)) {
        incidentLastAlertAtRef.current.delete(id);
      }
    });
    pendingIds.forEach((id) => {
      if (!activeIncidentIds.has(id) || !nextCriticalIds.has(id)) {
        pendingIds.delete(id);
      }
    });

    if (knownCriticalIdsRef.current.size > 0) {
      const newlyCriticalIds = [...nextCriticalIds].filter(
        id => !knownCriticalIdsRef.current.has(id)
      );

      newlyCriticalIds.forEach((id) => {
        pendingIds.add(id);
      });

      const cooldownReadyIds = [...pendingIds].filter((id) => {
        const lastIncidentAlertAt = incidentLastAlertAtRef.current.get(id) || 0;
        return now - lastIncidentAlertAt >= ALERT_COOLDOWN_MS;
      });

      const globalCooldownElapsed = now - lastAlertAtRef.current >= ALERT_COOLDOWN_MS;

      if (cooldownReadyIds.length > 0 && globalCooldownElapsed) {
        playCriticalIncidentAlert();
        lastAlertAtRef.current = now;
        cooldownReadyIds.forEach((id) => {
          incidentLastAlertAtRef.current.set(id, now);
          pendingIds.delete(id);
        });
      }
    }

    knownCriticalIdsRef.current = nextCriticalIds;
  }, [incidents, playCriticalIncidentAlert]);


  const filteredIncidents = useMemo(() => {
    let data = [...incidents];

    if (filter !== "all") {
      data = data.filter(i => i.status === filter);
    }

    if (search.trim() !== "") {
      data = data.filter(i =>
        i.description.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Always render highest-priority incidents first.
    data.sort((a, b) => {
      const priorityDiff = (b.priority_score || 0) - (a.priority_score || 0);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return (b.risk_score || 0) - (a.risk_score || 0);
    });

    return data;
  }, [incidents, filter, search]);

  const acceptIncident = async (id) => {
    await fetch("http://127.0.0.1:8000/accept-incident", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: id, responder_id: 1 })
    });

    setIncidents(prev =>
      prev.map(i => i.id === id ? { ...i, status: "in_progress" } : i)
    );
  };

  const resolveIncident = async (id) => {
    await fetch("http://127.0.0.1:8000/resolve-incident", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: id })
    });

    setIncidents(prev =>
      prev.map(i => i.id === id ? { ...i, status: "resolved" } : i)
    );
  };

  const predictSeverity = async () => {
    setIsLoadingSeverity(true);
    try {
      const response = await fetch("http://127.0.0.1:8000/predict-severity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formData.type,
          location_type: formData.location_type,
          people_affected: Number(formData.people_affected),
          time_of_day: formData.time_of_day
        })
      });
      
      const data = await response.json();
      if (data.severity) {
        setPredictedSeverity(data.severity);
        setFormData(prev => ({ ...prev, severity: data.severity }));
      } else {
        alert("Failed to predict severity: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      console.error("Error predicting severity:", err);
      alert("Error predicting severity: " + err.message);
    } finally {
      setIsLoadingSeverity(false);
    }
  };

  const createIncident = async (e) => {
    e.preventDefault();
    
    if (!predictedSeverity) {
      alert("Please predict severity first!");
      return;
    }

    if (!formData.description.trim()) {
      alert("Please enter a description!");
      return;
    }

    try {
      const finalPayload = {
        description: formData.description,
        category: formData.category,
        latitude: Number(formData.latitude),
        longitude: Number(formData.longitude),
        severity: formData.severity || predictedSeverity
      };

      console.log("Final create-incident payload:", finalPayload);

      const response = await fetch("http://127.0.0.1:8000/create-incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalPayload)
      });

      if (response.ok) {
        // Reset form
        setFormData({
          type: "fire",
          location_type: "urban",
          people_affected: 1,
          time_of_day: "day",
          severity: "",
          description: "",
          category: "fire",
          latitude: 28.6139,
          longitude: 77.209
        });
        setPredictedSeverity(null);
        setShowCreateForm(false);
        // Refresh incidents list
        fetch("http://127.0.0.1:8000/incidents")
          .then(res => res.json())
          .then(data => setIncidents(
            data.map(incident => ({
              ...incident,
              eta: incident.eta,
              escalation_seconds_remaining: incident.escalation_seconds_remaining ?? 0
            }))
          ))
          .catch(err => console.error(err));
      } else {
        alert("Failed to create incident");
      }
    } catch (err) {
      console.error("Error creating incident:", err);
      alert("Error creating incident: " + err.message);
    }
  };

  const stats = useMemo(() => {
    return {
      total: incidents.length,
      pending: incidents.filter(i => i.status === "pending").length,
      inProgress: incidents.filter(i => i.status === "in_progress").length,
      resolved: incidents.filter(i => i.status === "resolved").length,
    };
  }, [incidents]);

  return (
    <div className="page-content">
      <header className="top-bar">
        <div className="top-title">
          <span className="top-label">Incident Registry</span>
          <span className="top-subtitle">Complete incident history and analytics</span>
        </div>
      </header>

      <div className="content-area">

        {/* CREATE INCIDENT FORM */}
        {showCreateForm && (
          <div className="create-incident-form" style={{
            background: "#1a1a1a",
            border: "1px solid #444",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "20px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2>Create New Incident</h2>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setPredictedSeverity(null);
                  setFormData(prev => ({ ...prev, severity: "" }));
                }}
                style={{
                  background: "#444",
                  border: "none",
                  color: "#fff",
                  padding: "8px 12px",
                  borderRadius: "4px",
                  cursor: "pointer"
                }}
              >
                ✕ Close
              </button>
            </div>

            <form onSubmit={createIncident}>
              {/* Severity Prediction Section */}
              <div style={{
                background: "#222",
                padding: "15px",
                borderRadius: "6px",
                marginBottom: "20px",
                border: "1px solid #333"
              }}>
                <h3>📊 Predicted Severity</h3>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginBottom: "15px" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "12px", color: "#aaa" }}>
                      Incident Type
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) => {
                        setFormData({ ...formData, type: e.target.value, severity: "" });
                        setPredictedSeverity(null);
                      }}
                      style={{
                        width: "100%",
                        padding: "8px",
                        background: "#333",
                        border: "1px solid #555",
                        color: "#fff",
                        borderRadius: "4px"
                      }}
                    >
                      <option value="fire">Fire</option>
                      <option value="medical">Medical</option>
                      <option value="accident">Accident</option>
                      <option value="flood">Flood</option>
                      <option value="earthquake">Earthquake</option>
                      <option value="hazmat">Hazmat</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "12px", color: "#aaa" }}>
                      Location Type
                    </label>
                    <select
                      value={formData.location_type}
                      onChange={(e) => {
                        setFormData({ ...formData, location_type: e.target.value, severity: "" });
                        setPredictedSeverity(null);
                      }}
                      style={{
                        width: "100%",
                        padding: "8px",
                        background: "#333",
                        border: "1px solid #555",
                        color: "#fff",
                        borderRadius: "4px"
                      }}
                    >
                      <option value="urban">Urban</option>
                      <option value="rural">Rural</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "12px", color: "#aaa" }}>
                      People Affected
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formData.people_affected}
                      onChange={(e) => {
                        setFormData({ ...formData, people_affected: e.target.value, severity: "" });
                        setPredictedSeverity(null);
                      }}
                      style={{
                        width: "100%",
                        padding: "8px",
                        background: "#333",
                        border: "1px solid #555",
                        color: "#fff",
                        borderRadius: "4px"
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "12px", color: "#aaa" }}>
                      Time of Day
                    </label>
                    <select
                      value={formData.time_of_day}
                      onChange={(e) => {
                        setFormData({ ...formData, time_of_day: e.target.value, severity: "" });
                        setPredictedSeverity(null);
                      }}
                      style={{
                        width: "100%",
                        padding: "8px",
                        background: "#333",
                        border: "1px solid #555",
                        color: "#fff",
                        borderRadius: "4px"
                      }}
                    >
                      <option value="day">Day</option>
                      <option value="night">Night</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={predictSeverity}
                    disabled={isLoadingSeverity}
                    style={{
                      padding: "10px 20px",
                      background: "#0066ff",
                      border: "none",
                      color: "#fff",
                      borderRadius: "4px",
                      cursor: isLoadingSeverity ? "not-allowed" : "pointer",
                      opacity: isLoadingSeverity ? 0.6 : 1
                    }}
                  >
                    {isLoadingSeverity ? "⏳ Predicting..." : "🔮 Predict Severity"}
                  </button>

                  {predictedSeverity && (
                    <div style={{
                      padding: "10px 15px",
                      background: predictedSeverity === "HIGH" ? "#ff4444" : predictedSeverity === "MEDIUM" ? "#ffaa00" : "#44aa44",
                      borderRadius: "4px",
                      fontWeight: "bold",
                      color: "#fff"
                    }}>
                      Severity: {predictedSeverity}
                    </div>
                  )}

                </div>
              </div>

              {/* Incident Details Section */}
              <div style={{
                background: "#222",
                padding: "15px",
                borderRadius: "6px",
                marginBottom: "15px",
                border: "1px solid #333"
              }}>
                <h3>📝 Incident Details</h3>
                
                <div style={{ marginBottom: "15px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "5px" }}>
                    <label style={{ fontSize: "12px", color: "#aaa" }}>
                      Description
                    </label>
                    {isAnalyzingDescription && (
                      <span style={{ fontSize: "12px", color: "#8db7ff", fontStyle: "italic" }}>
                        AI is analyzing...
                      </span>
                    )}
                  </div>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe the incident..."
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "#333",
                      border: "1px solid #555",
                      color: "#fff",
                      borderRadius: "4px",
                      minHeight: "80px",
                      fontFamily: "inherit"
                    }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginBottom: "15px" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "12px", color: "#aaa" }}>
                      Category
                    </label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "8px",
                        background: "#333",
                        border: "1px solid #555",
                        color: "#fff",
                        borderRadius: "4px"
                      }}
                    >
                      <option value="fire">Fire</option>
                      <option value="medical">Medical</option>
                      <option value="accident">Accident</option>
                      <option value="flood">Flood</option>
                      <option value="earthquake">Earthquake</option>
                      <option value="hazmat">Hazmat</option>
                    </select>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div>
                      <label style={{ display: "block", marginBottom: "5px", fontSize: "12px", color: "#aaa" }}>
                        Latitude
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={formData.latitude}
                        onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "8px",
                          background: "#333",
                          border: "1px solid #555",
                          color: "#fff",
                          borderRadius: "4px"
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "5px", fontSize: "12px", color: "#aaa" }}>
                        Longitude
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={formData.longitude}
                        onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "8px",
                          background: "#333",
                          border: "1px solid #555",
                          color: "#fff",
                          borderRadius: "4px"
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="submit"
                  style={{
                    padding: "12px 24px",
                    background: "#00cc00",
                    border: "none",
                    color: "#000",
                    borderRadius: "4px",
                    fontWeight: "bold",
                    cursor: "pointer"
                  }}
                >
                  ✓ Create Incident
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false);
                    setPredictedSeverity(null);
                    setFormData(prev => ({ ...prev, severity: "" }));
                  }}
                  style={{
                    padding: "12px 24px",
                    background: "#666",
                    border: "none",
                    color: "#fff",
                    borderRadius: "4px",
                    cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* CREATE INCIDENT BUTTON */}
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              marginBottom: "20px",
              padding: "12px 24px",
              background: "#0066ff",
              border: "none",
              color: "#fff",
              borderRadius: "4px",
              fontWeight: "bold",
              cursor: "pointer",
              fontSize: "16px"
            }}
          >
            + Create New Incident
          </button>
        )}

        {/* FILTER CONTROLS */}
        <div className="incident-filters">
          <div className="filter-group">
            <button
              className={`filter-btn ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              className={`filter-btn ${filter === "pending" ? "active" : ""}`}
              onClick={() => setFilter("pending")}
            >
              Pending
            </button>
            <button
              className={`filter-btn ${filter === "in_progress" ? "active" : ""}`}
              onClick={() => setFilter("in_progress")}
            >
              In Progress
            </button>
            <button
              className={`filter-btn ${filter === "resolved" ? "active" : ""}`}
              onClick={() => setFilter("resolved")}
            >
              Resolved
            </button>
          </div>

          <div className="filter-group">
            <input
              className="filter-input"
              placeholder="Search description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <button
              className={`filter-btn filter-toggle ${sortByRisk ? "active" : ""}`}
              onClick={() => setSortByRisk(!sortByRisk)}
            >
              Sort by Risk
            </button>
          </div>
        </div>

        {/* STATS */}
        <div className="stats-preview" style={{ marginBottom: "20px" }}>
          <div className="mini-stat"><span>{stats.total}</span> Total</div>
          <div className="mini-stat"><span>{stats.pending}</span> Pending</div>
          <div className="mini-stat"><span>{stats.inProgress}</span> In Progress</div>
          <div className="mini-stat"><span>{stats.resolved}</span> Resolved</div>
        </div>

        {/* INCIDENT LIST */}
        {filteredIncidents.map((incident) => {
          const riskScore = Number(incident.risk_score) || 0;
          const priorityScore = Number(incident.priority_score) || 0;
          const isCriticalPriority = isCriticalIncident(incident);
          const isDelayedResponse = incident.eta > 40;
          const escalationSeconds = Number(incident.escalation_seconds_remaining) || 0;
          const escalationClass = escalationSeconds <= 30
            ? "escalation-critical"
            : escalationSeconds <= 60
              ? "escalation-warning"
              : "";
          const riskClass = riskScore >= 0.8
            ? "risk-critical"
            : riskScore >= 0.6
              ? "risk-high"
              : riskScore >= 0.4
                ? "risk-medium"
                : "risk-low";

          return (
            <div
              key={incident.id}
              className={`incident-card ${riskClass}`}
              style={isCriticalPriority ? {
                boxShadow: "0 0 0 1px rgba(255, 68, 68, 0.4), 0 0 22px rgba(255, 68, 68, 0.45)",
                borderColor: "rgba(255, 68, 68, 0.75)"
              } : undefined}
            >
              <div className="incident-header">
                <h3>{incident.description}</h3>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {isCriticalPriority && (
                    <span
                      style={{
                        padding: "4px 8px",
                        borderRadius: "999px",
                        background: "#ff4444",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: "11px",
                        letterSpacing: "0.4px"
                      }}
                    >
                      CRITICAL
                    </span>
                  )}
                  <span className={`status-badge status-${incident.status}`}>
                    {incident.status.replace("_", " ")}
                  </span>
                </div>
              </div>

              <div className="incident-meta">
                <span>Severity: <b>{incident.severity}</b></span>
                <span>Risk: <b>{riskScore}</b></span>
                {Number.isFinite(priorityScore) && (
                  <span>Priority: <b>{incident.priority_score}</b></span>
                )}
                <span style={isDelayedResponse ? { color: "#ff5f5f", fontWeight: 700 } : undefined}>
                  ETA: <b>{incident.eta} min</b>
                </span>
                <span>Escalation Risk: <b>{incident.escalation_risk?.toFixed(2) || 0}</b></span>
                <span className={escalationClass || undefined}>
                  Escalation in: <b>{formatTime(escalationSeconds)}</b>
                </span>
              </div>

              {isCriticalPriority && (
                <div className="priority-alert">🔥 AI PRIORITY INCIDENT</div>
              )}

              {isDelayedResponse && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: "rgba(255, 68, 68, 0.18)",
                    border: "1px solid rgba(255, 68, 68, 0.65)",
                    color: "#ff7b7b",
                    fontWeight: 700,
                    fontSize: "12px",
                  }}
                >
                  Delayed Response Expected
                </div>
              )}

              {incident.is_likely_to_escalate === true && (
                <div className="escalation-warning"> ⚠ High Escalation Risk </div>
              )}

              <div className="incident-actions">
                {incident.status === "pending" && (
                  <button
                    className="incident-btn accept"
                    onClick={() => acceptIncident(incident.id)}
                  >
                    Accept
                  </button>
                )}

                {incident.status === "in_progress" && (
                  <button
                    className="incident-btn resolve"
                    onClick={() => resolveIncident(incident.id)}
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          );
        })}

      </div>
    </div>
  );
}
