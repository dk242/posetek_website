import { Link, NavLink } from "react-router-dom";

const SECTIONS = [
  { path: "drills", icon: "library_books", label: "Drill library", short: "Drills" },
  { path: "organizations", icon: "groups", label: "Organizations", short: "Organizations" },
  { path: "accounts", icon: "supervisor_account", label: "Monitor accounts", short: "Accounts" },
  { path: "programs", icon: "auto_awesome", label: "Generate programs", short: "Programs" },
];

export default function AdminHeader({ ready, email, onSignOut }: {
  ready: boolean;
  email?: string;
  onSignOut: () => void;
}) {
  return (
    <header className="portal-header admin-header">
      <Link className="portal-brand" to="/admin" aria-label="PoseTek admin home">
        <span className="portal-brand-mark">P</span>
        <span className="admin-wordmark">POSETEK</span>
        <span className="admin-badge">Admin</span>
      </Link>
      {ready && (
        <nav className="admin-nav" aria-label="Admin sections">
          {SECTIONS.map(section => (
            <NavLink key={section.path} className={({ isActive }) => `quiet-button admin-nav-link${isActive ? " active" : ""}`}
              to={`/admin/${section.path}`} aria-label={section.label}>
              <span className="material-symbols-outlined" aria-hidden="true">{section.icon}</span>
              <span className="admin-nav-full">{section.label}</span>
              <span className="admin-nav-short" aria-hidden="true">{section.short}</span>
            </NavLink>
          ))}
        </nav>
      )}
      <div className="admin-header-right">
        {ready && <span className="admin-who" title={email}>{email}</span>}
        {ready && <a className="quiet-button admin-technique-link" href="/admin/analysis" aria-label="Technique review" title="Technique review">
          <span className="material-symbols-outlined" aria-hidden="true">edit_note</span>
          <span>Technique review</span>
        </a>}
        <button className="quiet-button admin-signout" type="button" onClick={onSignOut} aria-label="Sign out">
          <span className="material-symbols-outlined" aria-hidden="true">logout</span>
          <span>Sign out</span>
        </button>
      </div>
    </header>
  );
}
