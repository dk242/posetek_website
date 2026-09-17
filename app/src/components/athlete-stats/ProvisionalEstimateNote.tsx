import type { ProvisionalEstimate } from '../../lib/provisional-estimates';
import './provisional-estimate.css';

export default function ProvisionalEstimateNote({ estimate, score, planning = false }: {
  estimate: ProvisionalEstimate; score?: number | null; planning?: boolean;
}) {
  return <aside className="provisional-estimate-note" aria-label="Estimated dribbling result">
    <div><strong>Ball Control · Estimated</strong><span>About {estimate.estimatedTotalSeconds.toFixed(1)} s{score != null ? ` · ${Math.round(score)} vs D1` : ''}</span></div>
    <p>Finish not recorded. Uses the originally detected start and assumes the observed return pace continued.</p>
    <small>{planning ? 'Included as low-confidence coaching context for this plan.' : 'Hollow chart marker = estimate. Verified rating, rankings and completed-test counts exclude it.'} A valid Dribbling test replaces the estimate automatically.</small>
    <details><summary>Estimate assumptions</summary><p>A ±20% pace scenario gives {estimate.lowerSeconds.toFixed(2)}–{estimate.upperSeconds.toFixed(2)} s. This is a sensitivity range, not a confidence interval; an unseen pause or loss of the ball could change it.</p></details>
  </aside>;
}
