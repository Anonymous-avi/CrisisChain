import { Link, useLocation } from "react-router-dom";

export default function Sidebar() {
  const location = useLocation();

  const navItems = [
    { path: "/", label: "Control Center", icon: "🎛️" },
    { path: "/incidents", label: "Incidents", icon: "📋" },
    { path: "/responders", label: "Responders", icon: "🚑" },
    { path: "/analytics", label: "Analytics", icon: "📊" },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">🛰️</span>
          <span className="logo-text">CrisisChain</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`nav-item ${location.pathname === item.path ? "active" : ""}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {location.pathname === item.path && (
              <div className="nav-indicator" aria-hidden="true" />
            )}
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="system-status">
          <span className="status-dot pulse" />
          <span className="status-text">Systems online</span>
        </div>
      </div>
    </aside>
  );
}
