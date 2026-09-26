import { useId, useState } from 'react';
import { ACCESS_GROUPS, EQUIPMENT_LABELS, FACILITIES, SURFACES, setupErrors } from './training-access';
import type { SetupDraft } from './training-access';

export default function TrainingSetup({ value, onChange, onConfirm, disabled = false, title = 'Your training setup', confirmLabel = 'Use this setup' }: {
  value: SetupDraft; onChange: (value: SetupDraft) => void; onConfirm: (value: SetupDraft) => void; disabled?: boolean; title?: string; confirmLabel?: string;
}) {
  const [tab, setTab] = useState('space'), [attempted, setAttempted] = useState(false), id = useId();
  const update = (patch: Partial<SetupDraft>) => onChange({ ...value, ...patch, confirmed: false });
  const errors = attempted ? setupErrors(value) : [];
  const group = ACCESS_GROUPS.find(g => g.id === tab)!;
  const toggle = (equipment: string, checked: boolean) => {
    const next = checked ? [...new Set([...value.equipment, equipment])] : value.equipment.filter(e => e !== equipment);
    update({ equipment: next, equipmentAnswered: next.length > 0 });
  };
  return <section className="training-setup portal-card" aria-labelledby={`${id}-heading`}>
    <p className="eyebrow">Before your workout</p><h2 id={`${id}-heading`}>{title}</h2>
    <p>Choose what you can use today. Your AI coach will work within this setup.</p>
    <fieldset disabled={disabled}>
      <div className="training-setup-tabs" role="tablist" aria-label="Training setup categories" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const current = buttons.indexOf(event.target as HTMLButtonElement); if (current < 0) return;
        event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        setTab(ACCESS_GROUPS[index].id); buttons[index].focus();
      }}>
        {ACCESS_GROUPS.map(g => <button type="button" role="tab" key={g.id} id={`${id}-${g.id}`} aria-selected={tab === g.id} aria-controls={`${id}-panel`} tabIndex={tab === g.id ? 0 : -1} onClick={() => setTab(g.id)}>{g.label}{g.equipment.some(e => value.equipment.includes(e)) && <span aria-label="selected equipment"> {g.equipment.filter(e => value.equipment.includes(e)).length}</span>}</button>)}
      </div>
      <div className="training-setup-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0}>
        {tab === 'space' ? <>
          <div className="training-setup-fields"><label>Where will you train?<select value={value.facility} onChange={e => update({ facility: e.target.value as SetupDraft['facility'] })}><option value="">Choose a location</option>{Object.entries(FACILITIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>People training, including you<input type="number" inputMode="numeric" min={1} max={12} value={value.participantCount} onChange={e => update({ participantCount: e.target.value === '' ? '' : Number(e.target.value) })} /><small>1 for solo. Count only people taking part.</small></label></div>
          <p className="muted-copy">Gym access does not select equipment. Choose the items you can actually use in the other tabs.</p>
          <details className="training-space-details"><summary>Space and surface details</summary><p>Confirm what you know. Drills needing unconfirmed space will be left out.</p>
            <div className="training-setup-fields"><label>Clear length (metres)<input type="number" inputMode="decimal" min={0.1} max={1000} step="any" placeholder="Not sure" value={value.lengthMeters} onChange={e => update({ lengthMeters: e.target.value === '' ? '' : Number(e.target.value) })} /></label>
              <label>Clear width (metres)<input type="number" inputMode="decimal" min={0.1} max={1000} step="any" placeholder="Not sure" value={value.widthMeters} onChange={e => update({ widthMeters: e.target.value === '' ? '' : Number(e.target.value) })} /></label></div>
            <small>Measure usable space, clear of people and obstacles. 1 metre is about 3.3 feet.</small>
            <label>Training surface<select value={value.surface} onChange={e => update({ surface: e.target.value as SetupDraft['surface'] })}><option value="">Not confirmed</option>{Object.entries(SURFACES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="training-resource"><input type="checkbox" checked={value.overheadClear} onChange={e => update({ overheadClear: e.target.checked })} /><span>Clear overhead space for jumping or high ball throws</span></label>
          </details>
        </> : <>
          <p className="muted-copy">Select only equipment available for this session.</p>
          <div className="training-resource-grid">{group.equipment.map(equipment => <label className="training-resource" key={equipment}><input type="checkbox" checked={value.equipment.includes(equipment)} onChange={e => toggle(equipment, e.target.checked)} /><span>{EQUIPMENT_LABELS[equipment]}</span></label>)}</div>
          {tab === 'football' && <label className="training-resource"><input type="checkbox" checked={value.goalArea} onChange={e => update({ goalArea: e.target.checked })} /><span>Marked goal / penalty area available<small>For drills using the penalty spot, box or arc.</small></span></label>}
          {tab === 'strength' && <p className="muted-copy">Equipment access does not replace any required coaching clearance or supervision.</p>}
          {tab === 'timing' && <p className="muted-copy">A timer and a device that gives reaction cues serve different purposes. Select what you can use.</p>}
        </>}
      </div>
      <label className="training-resource training-no-equipment"><input type="checkbox" checked={value.equipmentAnswered && value.equipment.length === 0} onChange={e => update({ equipment: e.target.checked ? [] : value.equipment, equipmentAnswered: e.target.checked || value.equipment.length > 0 })} /><span>No equipment</span></label>
      <p className="training-selected" aria-live="polite">{value.equipment.length ? <><strong>{value.equipment.length} selected:</strong> {value.equipment.map(e => EQUIPMENT_LABELS[e]).join(', ')}</> : value.equipmentAnswered ? 'Bodyweight options only.' : 'Select equipment in the tabs, or choose No equipment.'}</p>
      {!!errors.length && <div className="player-error" role="alert"><p>Finish your setup:</p><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
      <button type="button" className="primary-cta" onClick={() => { setAttempted(true); if (!setupErrors(value).length) onConfirm({ ...value, confirmed: true }); }}>{confirmLabel}</button>
      <small className="training-setup-confirmation">By continuing, you confirm the selected equipment and space are available today. Update these selections whenever your setup changes.</small>
    </fieldset>
  </section>;
}
