import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "leaflet.heat";

const redIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const yellowIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-yellow.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const greenIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});



const getIcon = (incident) => {
  if (incident.status === "pending") return redIcon;
  if (incident.status === "in_progress") return yellowIcon;
  if (incident.status === "resolved") return greenIcon;
  return redIcon;
};


function getRiskLevel(score) {
  if (score >= 0.8) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

function MapSizeFix() {
  const map = useMap();

  useEffect(() => {
    const timeout = setTimeout(() => {
      map.invalidateSize();
    }, 60);

    return () => clearTimeout(timeout);
  }, [map]);

  return null;
}

function MapFlyto({ incidents }) {
  const map = useMap();
  const lastIncidentIdRef = useRef(null);

  useEffect(() => {
    if (incidents.length === 0) return;

    const latestIncident = incidents[incidents.length - 1];
    
    if (lastIncidentIdRef.current !== latestIncident.id) {
      lastIncidentIdRef.current = latestIncident.id;
      map.flyTo(
        [latestIncident.latitude, latestIncident.longitude],
        15,
        { duration: 2 }
      );
    }
  }, [incidents, map]);

  return null;
}

function severityToWeight(severity) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized === "high" || normalized === "critical") return 1.0;
  if (normalized === "medium") return 0.65;
  return 0.35;
}

function distanceInKm(lat1, lon1, lat2, lon2) {
  const toRadians = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function IncidentHeatLayer({ incidents, clusteredIncidentIds }) {
  const map = useMap();
  const heatLayerRef = useRef(null);

  useEffect(() => {
    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    const heatPoints = incidents
      .filter((incident) => Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude))
      .map((incident) => {
        const priorityWeight = Number(incident.priorityScore);
        const severityWeight = severityToWeight(incident.severity);
        const baseWeight = Number.isFinite(priorityWeight) && priorityWeight > 0
          ? Math.max(0.15, Math.min(1, priorityWeight))
          : severityWeight;
        const clusteredBoost = clusteredIncidentIds.has(incident.id) ? 1.35 : 1;
        const weight = Math.max(0.15, Math.min(1.5, baseWeight * clusteredBoost));

        return [incident.latitude, incident.longitude, weight];
      });

    if (heatPoints.length === 0) {
      return;
    }

    heatLayerRef.current = L.heatLayer(heatPoints, {
      radius: 32,
      blur: 20,
      maxZoom: 17,
      minOpacity: 0.35,
      gradient: {
        0.25: "#2d8cff",
        0.45: "#14b8a6",
        0.7: "#f59e0b",
        1.0: "#ef4444",
      },
    }).addTo(map);

    return () => {
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [incidents, map, clusteredIncidentIds]);

  return null;
}

function AnimatedNumber({ value, duration = 700 }) {
  const [displayValue, setDisplayValue] = useState(value);
  const rafRef = useRef(0);
  const startRef = useRef(null);
  const prevValueRef = useRef(value);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const fromValue = prevValueRef.current;
    startRef.current = null;
    prevValueRef.current = value;

    const step = (timestamp) => {
      if (!startRef.current) startRef.current = timestamp;
      const progress = Math.min((timestamp - startRef.current) / duration, 1);
      const nextValue = Math.round(
        fromValue + (value - fromValue) * progress
      );
      setDisplayValue(nextValue);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <span className="stat-value">{displayValue}</span>;
}

function StatCard({ label, value, accent, tag, pulse }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-label">{label}</div>
      <AnimatedNumber value={value} />
      <div className="stat-meta">
        {pulse ? <span className="status-dot pulse" /> : <span className="status-dot" />}
        <span className="stat-tag">{tag}</span>
      </div>
    </div>
  );
}

function ControlCenter() {
  const [incidents, setIncidents] = useState([]);

  const {
    clusteredIncidentIds,
    dangerZones,
  } = useMemo(() => {
    const validIncidents = incidents.filter(
      (incident) => Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude)
    );

    const radiusKm = 1.2;
    const minClusterSizeForDangerZone = 4;
    const adjacency = new Map();

    validIncidents.forEach((incident) => {
      adjacency.set(incident.id, []);
    });

    for (let i = 0; i < validIncidents.length; i += 1) {
      for (let j = i + 1; j < validIncidents.length; j += 1) {
        const a = validIncidents[i];
        const b = validIncidents[j];
        const distanceKm = distanceInKm(a.latitude, a.longitude, b.latitude, b.longitude);

        if (distanceKm <= radiusKm) {
          adjacency.get(a.id).push(b.id);
          adjacency.get(b.id).push(a.id);
        }
      }
    }

    const visited = new Set();
    const nextClusters = [];

    validIncidents.forEach((incident) => {
      if (visited.has(incident.id)) {
        return;
      }

      const queue = [incident.id];
      visited.add(incident.id);
      const clusterIds = [];

      while (queue.length > 0) {
        const currentId = queue.shift();
        clusterIds.push(currentId);

        const neighbors = adjacency.get(currentId) || [];
        neighbors.forEach((neighborId) => {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push(neighborId);
          }
        });
      }

      const members = validIncidents.filter((item) => clusterIds.includes(item.id));
      if (members.length > 0) {
        const centerLat = members.reduce((sum, item) => sum + item.latitude, 0) / members.length;
        const centerLng = members.reduce((sum, item) => sum + item.longitude, 0) / members.length;
        nextClusters.push({
          ids: clusterIds,
          size: members.length,
          centerLat,
          centerLng,
        });
      }
    });

    const nextDangerZones = nextClusters.filter((cluster) => cluster.size >= minClusterSizeForDangerZone);
    const nextClusteredIds = new Set(nextDangerZones.flatMap((cluster) => cluster.ids));

    return {
      clusteredIncidentIds: nextClusteredIds,
      dangerZones: nextDangerZones,
    };
  }, [incidents]);

  useEffect(() => {
    // Fetch existing incidents from backend
    fetch("http://127.0.0.1:8000/incidents")
      .then(res => res.json())
      .then(data => {
        console.log("Loaded incidents:", data);
        const formattedIncidents = data.map(incident => ({
          id: incident.id,
          description: incident.description,
          status: incident.status,
          latitude: Number(incident.latitude),
          longitude: Number(incident.longitude),
          severity: incident.severity,
          riskScore: Number(incident.risk_score) || 0,
          priorityScore: Number(incident.priority_score) || 0,
          estimatedResponseTime: Number(incident.estimated_response_time) || 15,
        }));
        console.log("Formatted incidents:", formattedIncidents);
        setIncidents(formattedIncidents);
      })
      .catch(err => console.error("Error loading incidents:", err));

    // Setup WebSocket for real-time updates
    const socket = new WebSocket("ws://127.0.0.1:8000/ws");

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "new_incident") {
        const incidentPayload = data.incident ?? data;
        setIncidents((prev) => [
          ...prev,
          {
            id: incidentPayload.id ?? data.incident_id,
            description: incidentPayload.description,
            status: "pending",
            latitude: Number(incidentPayload.latitude),
            longitude: Number(incidentPayload.longitude),
            severity: incidentPayload.severity,
            riskScore: Number(incidentPayload.risk_score) || 0,
            priorityScore: Number(incidentPayload.priority_score) || Number(data.priority_score) || 0,
            estimatedResponseTime: Number(incidentPayload.estimated_response_time) || 15,
          },
        ]);
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

    return () => socket.close();
  }, []);

  const {
    totalIncidents,
    pendingCount,
    inProgressCount,
    resolvedCount,
    highSeverityCount,
  } = useMemo(() => {
    return {
      totalIncidents: incidents.length,
      pendingCount: incidents.filter((i) => i.status === "pending").length,
      inProgressCount: incidents.filter((i) => i.status === "in_progress").length,
      resolvedCount: incidents.filter((i) => i.status === "resolved").length,
      highSeverityCount: incidents.filter((i) => {
        const normalizedSeverity = String(i.severity || "").toLowerCase();
        return normalizedSeverity === "high" || normalizedSeverity === "critical";
      }).length,
    };
  }, [incidents]);

  return (
    <div className="page-content">
      <header className="top-bar">
        <div className="top-title">
          <span className="top-label">CrisisChain Mission Control</span>
          <span className="top-subtitle">Earth Response Operations</span>
        </div>
        <div className="top-status">
          <span className="status-dot pulse" />
          Live systems online
        </div>
      </header>

      <div className="layout">
        <section className="map-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Operations Map</div>
              <div className="panel-subtitle">Global situational awareness</div>
            </div>
            <div className="panel-status">
              <span className="status-dot pulse" />
              Active feed
            </div>
          </div>

          {dangerZones.length > 0 && (
            <div
              style={{
                margin: "0 16px 10px",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 76, 76, 0.7)",
                background: "rgba(255, 76, 76, 0.14)",
                color: "#ff9a9a",
                fontWeight: 700,
                letterSpacing: "0.2px",
              }}
            >
              High Incident Density Area
              {` (${dangerZones.length} zone${dangerZones.length > 1 ? "s" : ""} detected)`}
            </div>
          )}

          <div className="map-shell">
            <MapContainer
              center={[28.6139, 77.209]}
              zoom={13}
              className="map-container"
              style={{ width: "100%", height: "100%" }}
              zoomControl={true}
            >
              <MapSizeFix />
              <MapFlyto incidents={incidents} />
              <IncidentHeatLayer incidents={incidents} clusteredIncidentIds={clusteredIncidentIds} />
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {incidents.map((incident) => (
                <Marker
                  key={incident.id}
                  position={[incident.latitude, incident.longitude]}
                  icon={getIcon(incident)}
                >
                  <Popup>
                    <div className="popup-content">
                      <div className="popup-header">
                        <b>{incident.description}</b>
                        <span className={`risk-badge risk-${getRiskLevel(incident.riskScore)}`}>
                          {getRiskLevel(incident.riskScore).toUpperCase()}
                        </span>
                      </div>
                      <div className="popup-meta">
                        <div className="popup-row">
                          <span className="label">Status:</span>
                          <span className="value">{incident.status}</span>
                        </div>
                        <div className="popup-row">
                          <span className="label">Severity:</span>
                          <span className="value">{incident.severity}</span>
                        </div>
                        <div className="popup-row">
                          <span className="label">Risk Score:</span>
                          <span className="value risk-score">{(incident.riskScore * 100).toFixed(0)}%</span>
                        </div>
                        <div className="popup-row">
                          <span className="label">Est. Response:</span>
                          <span className="value">{incident.estimatedResponseTime} min</span>
                        </div>
                      </div>
                      <div className="popup-footer">
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{width: `${incident.riskScore * 100}%`}}
                          />
                        </div>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </section>

        <aside className="stats-panel">
          <div className="panel-header compact">
            <div>
              <div className="panel-title">Mission Control Stats</div>
              <div className="panel-subtitle">Live incident telemetry</div>
            </div>
          </div>

          <div className="stats-grid">
            <StatCard
              label="Total Incidents"
              value={totalIncidents}
              accent="cyan"
              tag="All systems"
            />
            <StatCard
              label="Pending"
              value={pendingCount}
              accent="red"
              tag="Awaiting response"
              pulse={pendingCount > 0}
            />
            <StatCard
              label="In Progress"
              value={inProgressCount}
              accent="yellow"
              tag="Teams deployed"
              pulse={inProgressCount > 0}
            />
            <StatCard
              label="Resolved"
              value={resolvedCount}
              accent="green"
              tag="Mitigated"
            />
            <StatCard
              label="Critical Severity"
              value={highSeverityCount}
              accent="magenta"
              tag="Priority alerts"
              pulse={highSeverityCount > 0}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default ControlCenter;
