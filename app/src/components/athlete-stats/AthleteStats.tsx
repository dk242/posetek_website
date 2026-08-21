// CONTRACT — port of athlete-stats-view.js (window.PoseTekAthleteStats).
//
// Prop names mirror the option keys of the legacy `PoseTekAthleteStats.render(options)`
// call sites in athlete-portal.js and athlete-drill-view.js, verbatim. Any additional
// option keys a legacy call site passes must be added here as OPTIONAL props with the
// same name. The component owns the DOM behavior that legacy `bind(root)` attached.
//
// buildProfile(reps) is the pure profile/axis scoring used by athlete-mobile-pages.js.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AthleteStatsProps {
  athlete?: any;
  athleteName?: string;
  reps: any[];
  [key: string]: any;
}

export function buildProfile(_reps: any[]): any {
  // Ported by the stats port task from athlete-stats-view.js buildProfile().
  throw new Error("buildProfile not yet ported");
}

export default function AthleteStats(_props: AthleteStatsProps) {
  return <div className="athlete-stats" data-porting="athlete-stats-view.js" />;
}
