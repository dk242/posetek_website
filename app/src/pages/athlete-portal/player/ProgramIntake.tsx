import PersonalizedPrograms from "../../admin/views/PersonalizedPrograms";
import type { Row } from "./execution";

/** Both athlete experiences share draft generation, review and explicit activation. */
export default function ProgramIntake({ playerId, preview, initialText = "", onReady, onBack }: {
  playerId: string; athlete: Row; statsProfile: Row; preview: boolean; initialText?: string; onReady: () => void; onBack: () => void;
}) {
  return <section className="player-intake">
    <button className="quiet-button" onClick={onBack}>Back to training</button>
    {preview ? <div className="portal-card"><h2>Personalized training</h2><p>Sign in to build a draft from your results and review it before activation.</p><button className="primary-cta" onClick={onReady}>Return to sample training</button></div>
      : <PersonalizedPrograms key={playerId} role="athlete" playerId={playerId} initialText={initialText} onActivated={onReady} />}
  </section>;
}
