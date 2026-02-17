export default function Responders() {
  return (
    <div className="page-content">
      <header className="top-bar">
        <div className="top-title">
          <span className="top-label">Responder Management</span>
          <span className="top-subtitle">Track teams and personnel deployment</span>
        </div>
        <div className="top-status">
          <span className="status-dot pulse" />
          Network active
        </div>
      </header>

      <div className="content-area">
        <div className="card-placeholder">
          <h2>🚑 Response Teams</h2>
          <p>Monitor responder locations, availability, and assignments</p>
          <div className="stats-preview">
            <div className="mini-stat">
              <span className="value">0</span>
              <span className="label">Available</span>
            </div>
            <div className="mini-stat">
              <span className="value">0</span>
              <span className="label">Deployed</span>
            </div>
            <div className="mini-stat">
              <span className="value">0</span>
              <span className="label">On Standby</span>
            </div>
            <div className="mini-stat">
              <span className="value">0</span>
              <span className="label">Offline</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
