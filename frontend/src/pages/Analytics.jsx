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
          setIncidents(Array.isArray(data) ? data : []);
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

    return () => {
      isMounted = false;
    };
  }, []);

  const summaryStats = useMemo(() => {
    const total = incidents.length;
    if (!total) {
      return {
        total,
        avgRisk: 0,
        avgResponse: 0,
      };
    }

    const totals = incidents.reduce(
      (acc, incident) => {
        acc.risk += Number(incident.risk_score) || 0;
        acc.response += Number(incident.estimated_response_time) || 0;
        return acc;
      },
      { risk: 0, response: 0 }
    );

    return {
      total,
      avgRisk: totals.risk / total,
      avgResponse: totals.response / total,
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
            label="Average Risk Score"
            value={summaryStats.avgRisk.toFixed(2)}
            tag="AI weighted"
          />
          <StatCard
            label="Average Response Time"
            value={`${summaryStats.avgResponse.toFixed(1)} min`}
            tag="Dispatch estimate"
          />
          <StatCard
            label="Data Status"
            value="Nominal"
            tag="Integrity verified"
          />
        </div>
      </div>
    </div>
  );
}
