import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import PersonalizedPrograms from "../admin/views/PersonalizedPrograms";
import "../../styles/pose-portal.css";

/** Staff entry point. The scope loader and server both require current membership. */
export default function ProgramsPage() {
  const navigate = useNavigate(), location = useLocation();
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => auth.onAuthStateChanged(user => {
    if (!user) { setUid(null); navigate(`/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); }
    else if (user.emailVerified && user.email?.toLowerCase().endsWith("@posetek.net")) navigate(`/admin/programs${location.search}${location.hash}`, { replace: true });
    else setUid(user.uid);
  }), [navigate, location.pathname, location.search, location.hash]);
  return <div className="pt-pose portal-body pt-personalized">
    <header className="portal-header"><Link className="portal-brand" to="/organization">POSETEK</Link><nav><Link className="quiet-button" to="/organization">Organization</Link><Link className="quiet-button" to="/dashboard">Dashboard</Link></nav></header>
    <main className="personalized-shell">{uid ? <PersonalizedPrograms key={uid} role="staff" /> : <p role="status">Checking your sign-in…</p>}</main>
  </div>;
}
