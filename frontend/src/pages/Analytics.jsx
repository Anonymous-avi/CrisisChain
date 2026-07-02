import { useEffect, useMemo, useState } from "react";

function StatCard({ label, value, tag }) {
  return (
    <div className="stat-card accent-cyan">
      <div className="stat-label">{label}</div>
      <span className="stat-value">{value}</span>
      <div className="stat-meta">
        <span className="status-dot" />
        <span className="stat-tag">{tag}</span>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const normalizeIncident = (incident) => ({
    id: incident.id,
    severity: String(incident.severity || "").toUpperCase(),
    priority_score: Number(incident.priority_score) || 0,
    eta: Number(incident.eta ?? incident.estimated_response_time) || 0,
    status: incident.status,
  });

  useEffect(() => {
    let isMounted = true;

    const fetchIncidents = async () => {
      try {
        setLoading(true);
        const response = await fetch("http://127.0.0.1:8000/incidents");
        if (!response.ok) {
          throw new Error("Failed to fetch incidents.");
        }
        const data = await response.json();
        if (isMounted) {
          const normalized = Array.isArray(data) ? data.map(normalizeIncident) : [];
          setIncidents(normalized);
          setError(null);
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(fetchError.message || "Unable to load incidents.");
          setIncidents([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchIncidents();

    const socket = new WebSocket("ws://127.0.0.1:8000/ws");

    socket.onmessage = (event) => {
      if (!isMounted) {
        return;
      }

      const data = JSON.parse(event.data);

      if (data.type === "new_incident") {
        const payload = normalizeIncident(data.incident ?? data);
        setIncidents((prev) => {
          if (prev.some((incident) => incident.id === payload.id)) {
            return prev;
          }
          return [...prev, payload];
        });
      }

      if (data.type === "incident_escalated") {
        const payload = normalizeIncident(data.incident ?? data);
        setIncidents((prev) =>
          prev.map((incident) =>
            incident.id === payload.id
              ? { ...incident, ...payload }
              : incident
          )
        );
      }

      if (data.type === "incident_accepted") {
        setIncidents((prev) =>
          prev.map((incident) =>
            incident.id === data.incident_id
              ? { ...incident, status: "in_progress" }
              : incident
          )
        );
      }

      if (data.type === "incident_resolved") {
        setIncidents((prev) =>
          prev.map((incident) =>
            incident.id === data.incident_id
              ? { ...incident, status: "resolved" }
              : incident
          )
        );
      }
    };

    socket.onerror = () => {
      if (isMounted) {
        setError("Live analytics feed disconnected.");
      }
    };

    return () => {
      isMounted = false;
      socket.close();
    };
  }, []);

  const summaryStats = useMemo(() => {
    const total = incidents.length;
    if (!total) {
      return {
        total,
        highSeverityCount: 0,
        avgEta: 0,
        criticalAlerts: 0,
      };
    }

    const totals = incidents.reduce(
      (acc, incident) => {
        if (incident.severity === "HIGH") {
          acc.highSeverityCount += 1;
        }
        if (incident.priority_score > 0.8 || incident.severity === "CRITICAL") {
          acc.criticalAlerts += 1;
        }
        acc.eta += incident.eta;
        return acc;
      },
      { highSeverityCount: 0, eta: 0, criticalAlerts: 0 }
    );

    return {
      total,
      highSeverityCount: totals.highSeverityCount,
      avgEta: totals.eta / total,
      criticalAlerts: totals.criticalAlerts,
    };
  }, [incidents]);

  const renderStateBanner = () => {
    if (loading) {
      return <div className="analytics-state-banner">Loading incident telemetry...</div>;
    }

    if (error) {
      return <div className="analytics-state-banner error">{error}</div>;
    }

    return null;
  };

  return (
    <div className="page-content">
      <header className="top-bar">
        <div className="top-title">
          <span className="top-label">System Analytics</span>
          <span className="top-subtitle">Incident telemetry and response metrics</span>
        </div>
      </header>

      <div className="content-area">
        {renderStateBanner()}

        <div className="stats-grid">
          <StatCard
            label="Total Incidents"
            value={summaryStats.total}
            tag="Active feed"
          />
          <StatCard
            label="HIGH Severity Incidents"
            value={summaryStats.highSeverityCount}
            tag="Urgent load"
          />
          <StatCard
            label="Average ETA"
            value={`${summaryStats.avgEta.toFixed(1)} min`}
            tag="Dispatch estimate"
          />
          <StatCard
            label="Critical Alerts"
            value={summaryStats.criticalAlerts}
            tag="Immediate attention"
          />
        </div>
      </div>
    </div>
  );
}
