import { useState } from "react";
import "../../../components/training-load.css";
export type StartConfirmation = { equipmentConfirmed: boolean; supervision: "qualifiedCoach" | "unavailable"; painFlag: boolean };
export default function TrainingStartConfirmation({ disabled, resuming, onStart }: { disabled: boolean; resuming: boolean; onStart: (confirmation: StartConfirmation) => void }) {
  const [equipment, setEquipment] = useState(false);
  const [supervision, setSupervision] = useState<"" | StartConfirmation["supervision"]>("");
  const [pain, setPain] = useState<"" | "yes" | "no">("");
  return <section className="portal-card training-start-confirmation"><h3>Check today’s training conditions</h3><fieldset disabled={disabled}>
    <label><input type="checkbox" checked={equipment} onChange={e => setEquipment(e.target.checked)} /> I have the equipment listed for every exercise today.</label>
    <label>Qualified supervision today<select value={supervision} onChange={e => setSupervision(e.target.value as typeof supervision)}><option value="">Choose today’s arrangement</option><option value="qualifiedCoach">A qualified coach is supervising</option><option value="unavailable">No qualified coach is available</option></select></label>
    <label>Do you have pain or a restriction that affects this session?<select value={pain} onChange={e => setPain(e.target.value as typeof pain)}><option value="">Choose an answer</option><option value="no">No</option><option value="yes">Yes — I need a review</option></select></label>
    {pain === "yes" && <p role="status">Pause training and ask your parent or coach for a review.</p>}
    <p>Independent exercise requires your reviewer’s approval. Your plan and current clearance are checked before the session opens.</p>
    <button type="button" className="primary-cta" disabled={!equipment || !supervision || pain !== "no"} onClick={() => supervision && onStart({ equipmentConfirmed: equipment, supervision, painFlag: pain === "yes" })}>{disabled ? "Checking…" : resuming ? "Check and resume workout" : "Check and start workout"}</button>
  </fieldset></section>;
}
