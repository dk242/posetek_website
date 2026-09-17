import { Navigate, useLocation } from "react-router-dom";

export default function PlannerRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`/admin/programs${search}${hash}`} replace />;
}
