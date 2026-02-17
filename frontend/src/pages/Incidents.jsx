import { useEffect, useMemo, useState } from "react";

export default function Incidents() {
  const [incidents, setIncidents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortByRisk, setSortByRisk] = useState(false);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/incidents")
      .then(res => res.json())
      .then(data => setIncidents(data))
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
            estimated_response_time: incidentData.estimated_response_time
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

    if (sortByRisk) {
      data.sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
    } else {
      data.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
    }

    return data;
  }, [incidents, filter, search, sortByRisk]);

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
          const priorityScore = Number(incident.priority_score);
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
            >
              <div className="incident-header">
                <h3>{incident.description}</h3>
                <span className={`status-badge status-${incident.status}`}>
                  {incident.status.replace("_", " ")}
                </span>
              </div>

              <div className="incident-meta">
                <span>Severity: <b>{incident.severity}</b></span>
                <span>Risk: <b>{riskScore}</b></span>
                {Number.isFinite(priorityScore) && (
                  <span>Priority: <b>{incident.priority_score}</b></span>
                )}
                <span>ETA: <b>{incident.estimated_response_time} min</b></span>
                <span>Escalation Risk: <b>{incident.escalation_risk?.toFixed(2) || 0}</b></span>
              </div>

              {priorityScore > 1.2 && (
                <div className="priority-alert">🔥 AI PRIORITY INCIDENT</div>
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
