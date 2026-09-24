import { Link, useLocation } from "react-router-dom";
import { accountContext, accountQuery } from "../lib/accountHierarchy";

export default function AdminBreadcrumbs() {
  const location = useLocation();
  const match = location.pathname.match(/^\/admin\/accounts\/player\/([^/]+)(?:\/results(?:\/([^/]+)(?:\/([^/]+))?)?)?/);
  if (!match) return null;
  const [, playerId, drillKey, repId] = match;
  const query = accountQuery(accountContext(location.search));
  const playerPath = `/admin/accounts/player/${playerId}`;
  const resultsPath = `${playerPath}/results`;
  const crumbs = [
    { label: "Accounts", path: `/admin/accounts${query}` },
    { label: "Player", path: `${playerPath}${query}` },
    ...(location.pathname.includes("/results") ? [{ label: "Results", path: `${resultsPath}${query}` }] : []),
    ...(drillKey ? [{ label: decodeURIComponent(drillKey).replaceAll("-", " "), path: `${resultsPath}/${drillKey}${query}` }] : []),
    ...(repId ? [{ label: "Rep", path: null }] : []),
  ];
  return <nav className="admin-breadcrumbs" aria-label="Breadcrumb"><ol>{crumbs.map((crumb, index) => <li key={`${crumb.label}:${index}`}>{crumb.path && index < crumbs.length - 1 ? <Link to={crumb.path}>{crumb.label}</Link> : <span aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>}</li>)}</ol></nav>;
}
