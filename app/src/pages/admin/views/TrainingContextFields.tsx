import { TRAINING_DAYS, type TrainingContext } from "../lib/wholeBodyTraining";

export default function TrainingContextFields({ value, onChange, playerName, disabled = false }: { value: TrainingContext; onChange: (value: TrainingContext) => void; playerName: string; disabled?: boolean }) {
  const set = (patch: Partial<TrainingContext>) => onChange({ ...value, ...patch });
  return <fieldset disabled={disabled} className="training-context"><legend>Training circumstances · {playerName}</legend>
    <p className="personalized-meta">Record this player’s full week, including training outside PoseTek. These reported details do not grant clearance for loaded exercises.</p>
    <div className="personalized-fields">
      <label>Training start date<input type="date" value={value.startDate} onChange={e => set({ startDate: e.target.value })} /></label>
      <label>Reported strength experience<select value={value.resistanceExperience} onChange={e => set({ resistanceExperience: e.target.value as TrainingContext["resistanceExperience"] })}><option value="unknown">Not recorded</option><option value="new">New to structured strength training</option><option value="experienced">Has structured training experience</option></select></label>
      <label>Qualified supervision available<select value={value.supervision} onChange={e => set({ supervision: e.target.value as TrainingContext["supervision"] })}><option value="unconfirmed">Not confirmed</option><option value="qualifiedCoach">Qualified coach available</option><option value="unavailable">No qualified coach available</option></select></label>
    </div>
    <fieldset><legend>Proposed PoseTek training days</legend><div className="personalized-equipment">{TRAINING_DAYS.map((day, index) => <label key={day}><input type="checkbox" checked={value.sessionDays.includes(index)} onChange={() => set({ sessionDays: value.sessionDays.includes(index) ? value.sessionDays.filter(d => d !== index) : [...value.sessionDays, index].sort() })} />{day}</label>)}</div></fieldset>
    <h4>Other weekly commitments</h4>
    {!value.externalSchedule.length && <p className="personalized-meta">No outside sessions recorded. Confirm below only if the player has none.</p>}
    {value.externalSchedule.map((session, index) => <div key={index} className="training-schedule-row">
      <label>Day<select value={session.day} onChange={e => set({ scheduleConfirmed: false, externalSchedule: value.externalSchedule.map((s, i) => i === index ? { ...s, day: +e.target.value } : s) })}>{TRAINING_DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
      <label>Activity<select value={session.activity} onChange={e => set({ scheduleConfirmed: false, externalSchedule: value.externalSchedule.map((s, i) => i === index ? { ...s, activity: e.target.value as typeof s.activity } : s) })}><option value="practice">Team practice</option><option value="match">Match</option><option value="strength">Gym / strength</option><option value="other">Other sport or activity</option></select></label>
      <label>Minutes<input type="number" min={1} max={360} value={session.durationMinutes} onChange={e => set({ scheduleConfirmed: false, externalSchedule: value.externalSchedule.map((s, i) => i === index ? { ...s, durationMinutes: +e.target.value } : s) })} /></label>
      <label>Expected effort<select value={session.effort} onChange={e => set({ scheduleConfirmed: false, externalSchedule: value.externalSchedule.map((s, i) => i === index ? { ...s, effort: e.target.value as typeof s.effort } : s) })}><option value="easy">Easy</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select></label>
      <button type="button" className="quiet-button" aria-label={`Remove outside session ${index + 1}`} onClick={() => set({ scheduleConfirmed: false, externalSchedule: value.externalSchedule.filter((_, i) => i !== index) })}>Remove</button>
    </div>)}
    <button type="button" className="quiet-button" disabled={value.externalSchedule.length >= 21} onClick={() => set({ scheduleConfirmed: false, externalSchedule: [...value.externalSchedule, { day: 1, activity: "practice", durationMinutes: 60, effort: "moderate" }] })}>Add outside session</button>
    <label className="personalized-checkbox"><input type="checkbox" checked={value.scheduleConfirmed} onChange={e => set({ scheduleConfirmed: e.target.checked })} />This is the complete weekly schedule for {playerName}, including matches, practices, gym work and other sports.</label>
    <label className="personalized-checkbox"><input type="checkbox" checked={value.equipmentConfirmed} onChange={e => set({ equipmentConfirmed: e.target.checked })} />The selected equipment is available to {playerName}.</label>
  </fieldset>;
}
