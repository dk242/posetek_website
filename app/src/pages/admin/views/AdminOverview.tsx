import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { InsightsWorkspace } from "../../insights/InsightsPage";

const Preview = import.meta.env.DEV ? lazy(() => import("../../insights/InsightsPreview")) : null;

export default function AdminOverview({ uid, preview = false }: { uid: string; preview?: boolean }) {
  const location = useLocation();
  if (preview && Preview) return <Suspense fallback={<p role="status">Loading synthetic preview…</p>}><Preview embedded /></Suspense>;
  // A report cursor belongs to one exact query. Remounting also cancels late
  // requests when the header changes scope or browser history restores filters.
  return <InsightsWorkspace key={`${uid}:${location.search}`} uid={uid} embedded />;
}
