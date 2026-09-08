// Create and edit a v2 drill, and upload a clip into any of the four media
// slots. DRILL_CATALOG_V2_CONTRACT.md §1 (the fields and their bounds), §6.2
// (media), §7 (the version bump) and §8 (id allocation).
//
// The brief's create flow is "first ask for input into all of the fields, then
// … take videos", so media upload appears once the document exists. The app
// films; the web uploads a file — same Storage path, same document shape.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatDoseText, formatRestText } from "../../../lib/contracts/drillV2";
import type { CatalogDrill } from "../../../lib/contracts/drillV2";
import {
  DOMAINS,
  DRILL_STATUSES,
  EQUIPMENT,
  MEDIA_SLOTS,
  MEDIA_SLOT_LABELS,
  POSITIONS,
  POSITION_LABELS,
  REP_UNITS,
  domainLabel,
  isContinuousUnit,
  isPosition,
} from "../../../lib/contracts/types";
import type { CatalogDose, Domain, DrillStatus, MediaSlot, Position } from "../../../lib/contracts/types";
import {
  createDrill,
  loadDrill,
  mediaFileErrors,
  removeDrillMedia,
  uploadDrillMedia,
} from "../lib/catalog";
import type { DrillWrite } from "../lib/catalog";

interface FormState {
  name: string;
  domain: Domain;
  minAge: number;
  maxAge: number;
  difficultyLevel: number;
  equipment: string[];
  requiresPartner: boolean;
  /** "" is the form's "Any position"; it is written as null. */
  positionSpecific: Position | "";
  setup: string;
  steps: string[];
  setsMin: number; setsMax: number;
  repsMin: number; repsMax: number;
  repUnit: string;
  perSide: boolean;
  restSecondsMin: number; restSecondsMax: number;
  restScope: "reps" | "sets";
  restBetweenSetsSeconds: number | null;
  familiarizationReps: number;
  maxFrequencyPerWeek: number;
  coachComments: string[];
  adaptiveLevers: string[];
  status: DrillStatus;
}

const BLANK: FormState = {
  name: "",
  domain: "dribbling",
  minAge: 9,
  maxAge: 19,
  difficultyLevel: 2,
  equipment: ["ball"],
  requiresPartner: false,
  positionSpecific: "",
  setup: "",
  steps: [""],
  setsMin: 3, setsMax: 4,
  repsMin: 6, repsMax: 8,
  repUnit: "reps",
  perSide: false,
  restSecondsMin: 45, restSecondsMax: 60,
  restScope: "sets",
  restBetweenSetsSeconds: null,
  familiarizationReps: 0,
  maxFrequencyPerWeek: 2,
  coachComments: [""],
  adaptiveLevers: [""],
  status: "draft",
};

function formFromDrill(drill: CatalogDrill): FormState {
  const dose = drill.dose || {};
  const num = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return {
    name: drill.name,
    domain: ((DOMAINS as readonly string[]).includes(drill.domain) ? drill.domain : "dribbling") as Domain,
    minAge: drill.minAge,
    maxAge: drill.maxAge,
    difficultyLevel: drill.difficultyLevel,
    equipment: drill.equipment,
    requiresPartner: drill.requiresPartner,
    positionSpecific: isPosition(drill.positionSpecific) ? drill.positionSpecific : "",
    setup: drill.howTo.setup,
    steps: drill.howTo.steps.length ? drill.howTo.steps : [""],
    setsMin: num(dose.setsMin, 1), setsMax: num(dose.setsMax, num(dose.setsMin, 1)),
    repsMin: num(dose.repsMin, 1), repsMax: num(dose.repsMax, num(dose.repsMin, 1)),
    repUnit: String(dose.repUnit ?? "reps"),
    perSide: dose.perSide === true,
    restSecondsMin: num(dose.restSecondsMin, 0), restSecondsMax: num(dose.restSecondsMax, num(dose.restSecondsMin, 0)),
    restScope: dose.restScope === "reps" ? "reps" : "sets",
    restBetweenSetsSeconds:
      typeof dose.restBetweenSetsSecondsMax === "number" ? Math.round(dose.restBetweenSetsSecondsMax) : null,
    familiarizationReps: num(dose.familiarizationReps, 0),
    maxFrequencyPerWeek: drill.maxFrequencyPerWeek,
    coachComments: drill.coachComments.length ? drill.coachComments : [""],
    adaptiveLevers: drill.adaptiveLevers.length ? drill.adaptiveLevers : [""],
    status: drill.status,
  };
}

function doseFrom(form: FormState): CatalogDose {
  const continuous = isContinuousUnit(form.repUnit);
  const dose: CatalogDose = {
    setsMin: form.setsMin,
    setsMax: form.setsMax,
    repsMin: form.repsMin,
    repsMax: form.repsMax,
    repUnit: form.repUnit,
    perSide: form.perSide,
    restSecondsMin: form.restSecondsMin,
    restSecondsMax: form.restSecondsMax,
    // A timed or distance drill's value is one continuous set, so per-rep rest
    // is not representable (catalog §11).
    restScope: continuous ? "sets" : form.restScope,
    restBetweenSetsSecondsMin: form.restBetweenSetsSeconds,
    restBetweenSetsSecondsMax: form.restBetweenSetsSeconds,
    familiarizationReps: continuous ? 0 : form.familiarizationReps,
  };
  dose.doseText = formatDoseText(dose);
  dose.restText = formatRestText(dose);
  return dose;
}

function cleaned(list: string[], max: number, maxChars: number): string[] {
  return list.map(entry => entry.trim().slice(0, maxChars)).filter(Boolean).slice(0, max);
}

function formErrors(form: FormState): string[] {
  const errors: string[] = [];
  const name = form.name.trim();
  if (name.length < 1 || name.length > 80) errors.push("The name must be 1–80 characters.");
  if (form.setup.length > 400) errors.push("The set-up is limited to 400 characters.");
  const steps = cleaned(form.steps, 12, 240);
  if (steps.length < 1) errors.push("Write at least one how-to step.");
  if (form.minAge < 5 || form.maxAge > 99 || form.minAge > form.maxAge) {
    errors.push("Ages must run from at least 5 to at most 99, low to high.");
  }
  if (form.difficultyLevel < 1 || form.difficultyLevel > 5) errors.push("Difficulty is 1–5.");
  if (form.maxFrequencyPerWeek < 1 || form.maxFrequencyPerWeek > 7) {
    errors.push("Maximum frequency per week is 1–7.");
  }
  if (form.setsMin < 1 || form.setsMax < form.setsMin) errors.push("Sets must be at least 1, low to high.");
  if (form.repsMin < 1 || form.repsMax < form.repsMin) errors.push("The per-set amount must be at least 1, low to high.");
  if (form.restSecondsMin < 0 || form.restSecondsMax < form.restSecondsMin) {
    errors.push("Rest must be 0 or more, low to high.");
  }
  if (cleaned(form.coachComments, 8, 200).length > 8) errors.push("At most eight coach comments.");
  if (cleaned(form.adaptiveLevers, 6, 200).length > 6) errors.push("At most six adaptive levers.");
  return errors;
}

function writeFrom(form: FormState): DrillWrite {
  return {
    name: form.name.trim(),
    domain: form.domain,
    minAge: form.minAge,
    maxAge: form.maxAge,
    difficultyLevel: form.difficultyLevel,
    equipment: form.equipment,
    requiresPartner: form.requiresPartner,
    positionSpecific: form.positionSpecific || null,
    howTo: { setup: form.setup.trim(), steps: cleaned(form.steps, 12, 240) },
    dose: doseFrom(form) as Record<string, unknown>,
    maxFrequencyPerWeek: form.maxFrequencyPerWeek,
    coachComments: cleaned(form.coachComments, 8, 200),
    adaptiveLevers: cleaned(form.adaptiveLevers, 6, 200),
    status: form.status,
  };
}

export default function DrillForm({ mode }: { mode: "create" | "edit" }) {
  const { drillId = "" } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(BLANK);
  const [drill, setDrill] = useState<CatalogDrill | null>(null);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = mode === "create" ? "New drill | PoseTek admin" : `Edit ${drillId} | PoseTek admin`;
    if (mode !== "edit") return;
    loadDrill(drillId)
      .then(found => {
        if (!found) { setMessage(`${drillId} is not in the catalog.`); return; }
        setDrill(found);
        setForm(formFromDrill(found));
      })
      .catch(error => setMessage(error?.message || "That drill could not be loaded."))
      .finally(() => setLoading(false));
  }, [mode, drillId]);

  const errors = useMemo(() => formErrors(form), [form]);
  const previewDose = useMemo(() => doseFrom(form), [form]);
  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  async function save() {
    if (errors.length) return;
    setSaving(true);
    setMessage(null);
    try {
      if (mode === "create") {
        const newId = await createDrill(writeFrom(form));
        navigate(`/admin/drills/${newId}/edit`, { replace: true });
        setMessage(`Created ${newId}. Add its clips below when you have them.`);
      } else {
        const { updateDrill } = await import("../lib/catalog");
        const version = await updateDrill(drillId, writeFrom(form));
        setMessage(`Saved. The catalog is now version ${version}, so every device refetches.`);
      }
    } catch (error: any) {
      setMessage(error?.message || "That change could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="portal-loading"><span className="spinner" /><p>Loading {drillId}…</p></div>;
  if (mode === "edit" && drill?.needsMigration) {
    return (
      <div className="admin-banner warn">
        <span className="material-symbols-outlined">sync_problem</span>
        <p>
          {drillId} is still a catalog v1 document. Editing it here would write a v2 shape over half
          a migration that the mobile side owns, so the web console reads it and leaves it alone.{" "}
          <Link to={`/admin/drills/${drillId}`}>Back to the drill</Link>.
        </p>
      </div>
    );
  }

  return (
    <>
      <section className="admin-heading">
        <Link className="icon-button" to={mode === "create" ? "/admin/drills" : `/admin/drills/${drillId}`} aria-label="Back">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <p className="eyebrow">{mode === "create" ? "New drill" : `Editing ${drillId}`}</p>
          <h1>{form.name || "Untitled drill"}</h1>
          <p>
            {mode === "create"
              ? "The id is allocated when you save — the domain decides its prefix, and it never changes afterwards."
              : "Saving bumps the catalog version, which is what makes every phone refetch."}
          </p>
        </div>
      </section>

      {message && <div className="admin-banner good"><span className="material-symbols-outlined">info</span><p>{message}</p></div>}

      <div className="admin-grid-two">
        <section className="admin-card">
          <h3>Identity</h3>
          <div className="admin-form">
            <label className="admin-field">
              <span>Name</span>
              <input value={form.name} maxLength={80} onChange={event => set("name")(event.target.value)} />
            </label>
            <div className="admin-field-row">
              <label className="admin-field">
                <span>Domain</span>
                <select value={form.domain} onChange={event => set("domain")(event.target.value as Domain)}>
                  {DOMAINS.map(value => <option key={value} value={value}>{domainLabel(value)}</option>)}
                </select>
              </label>
              <label className="admin-field">
                <span>Status</span>
                <select value={form.status} onChange={event => set("status")(event.target.value as DrillStatus)}>
                  {DRILL_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            </div>
            <label className="admin-field">
              <span>Position-specific</span>
              <select
                value={form.positionSpecific}
                onChange={event => set("positionSpecific")(event.target.value as Position | "")}
              >
                <option value="">Any position</option>
                {POSITIONS.map(value => <option key={value} value={value}>{POSITION_LABELS[value]} only</option>)}
              </select>
            </label>
            <p className="admin-note">
              Leave on “Any position” unless the drill only makes sense for one — a position-specific
              drill is prescribed only to athletes recorded in that position.
            </p>
            <div className="admin-field-row">
              <label className="admin-field">
                <span>Minimum age</span>
                <input type="number" min={5} max={99} value={form.minAge}
                       onChange={event => set("minAge")(Number(event.target.value))} />
              </label>
              <label className="admin-field">
                <span>Maximum age</span>
                <input type="number" min={5} max={99} value={form.maxAge}
                       onChange={event => set("maxAge")(Number(event.target.value))} />
              </label>
              <label className="admin-field">
                <span>Difficulty (1–5)</span>
                <input type="number" min={1} max={5} value={form.difficultyLevel}
                       onChange={event => set("difficultyLevel")(Number(event.target.value))} />
              </label>
              <label className="admin-field">
                <span>Max per week</span>
                <input type="number" min={1} max={7} value={form.maxFrequencyPerWeek}
                       onChange={event => set("maxFrequencyPerWeek")(Number(event.target.value))} />
              </label>
            </div>
            <div className="admin-field">
              <span>Equipment</span>
              <div className="admin-checks">
                {EQUIPMENT.map(item => (
                  <label key={item}>
                    <input
                      type="checkbox"
                      checked={form.equipment.includes(item)}
                      onChange={event => set("equipment")(
                        event.target.checked
                          ? [...form.equipment, item]
                          : form.equipment.filter(entry => entry !== item),
                      )}
                    />
                    {item}
                  </label>
                ))}
              </div>
              <label className="admin-checks" style={{ marginTop: 8 }}>
                <span>
                  <input type="checkbox" checked={form.requiresPartner}
                         onChange={event => set("requiresPartner")(event.target.checked)} />{" "}
                  Needs a second person (a server, a defender, a chaser)
                </span>
              </label>
            </div>
          </div>
        </section>

        <section className="admin-card">
          <h3>Dose and rest</h3>
          <div className="admin-form">
            <div className="admin-field-row">
              <label className="admin-field">
                <span>Sets (low)</span>
                <input type="number" min={1} value={form.setsMin} onChange={event => set("setsMin")(Number(event.target.value))} />
              </label>
              <label className="admin-field">
                <span>Sets (high)</span>
                <input type="number" min={1} value={form.setsMax} onChange={event => set("setsMax")(Number(event.target.value))} />
              </label>
              <label className="admin-field">
                <span>Per set (low)</span>
                <input type="number" min={1} value={form.repsMin} onChange={event => set("repsMin")(Number(event.target.value))} />
              </label>
              <label className="admin-field">
                <span>Per set (high)</span>
                <input type="number" min={1} value={form.repsMax} onChange={event => set("repsMax")(Number(event.target.value))} />
              </label>
            </div>
            <div className="admin-field-row">
              <label className="admin-field">
                <span>Unit</span>
                <select value={form.repUnit} onChange={event => set("repUnit")(event.target.value)}>
                  {REP_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </label>
              <label className="admin-field">
                <span>Rest (low, s)</span>
                <input type="number" min={0} value={form.restSecondsMin} onChange={event => set("restSecondsMin")(Number(event.target.value))} />
              </label>
              <label className="admin-field">
                <span>Rest (high, s)</span>
                <input type="number" min={0} value={form.restSecondsMax} onChange={event => set("restSecondsMax")(Number(event.target.value))} />
              </label>
              <label className="admin-field">
                <span>Rest applies</span>
                <select
                  value={isContinuousUnit(form.repUnit) ? "sets" : form.restScope}
                  disabled={isContinuousUnit(form.repUnit)}
                  onChange={event => set("restScope")(event.target.value as "reps" | "sets")}
                >
                  <option value="sets">between sets</option>
                  <option value="reps">between reps</option>
                </select>
              </label>
            </div>
            {isContinuousUnit(form.repUnit) && (
              <p className="admin-note">
                A {form.repUnit} value is one continuous set, so rest always sits between sets and
                familiarization reps do not apply.
              </p>
            )}
            <div className="admin-field-row">
              <label className="admin-field">
                <span>Rest between sets (s, optional)</span>
                <input
                  type="number" min={0}
                  value={form.restBetweenSetsSeconds ?? ""}
                  onChange={event => set("restBetweenSetsSeconds")(
                    event.target.value === "" ? null : Number(event.target.value),
                  )}
                />
              </label>
              <label className="admin-field">
                <span>Familiarization reps</span>
                <input type="number" min={0} disabled={isContinuousUnit(form.repUnit)}
                       value={form.familiarizationReps}
                       onChange={event => set("familiarizationReps")(Number(event.target.value))} />
              </label>
              <label className="admin-field">
                <span>Per side</span>
                <select value={form.perSide ? "yes" : "no"} onChange={event => set("perSide")(event.target.value === "yes")}>
                  <option value="no">no</option>
                  <option value="yes">yes — each side</option>
                </select>
              </label>
            </div>
            <p className="admin-note">
              Reads as: <strong>{previewDose.doseText || "—"}</strong>
              {previewDose.restText ? ` · rest ${previewDose.restText}` : ""}
            </p>
          </div>
        </section>
      </div>

      <section className="admin-card">
        <h3>How to do it</h3>
        <div className="admin-form">
          <label className="admin-field">
            <span>Set up (≤ 400 characters — where the cones, the ball and the wall go)</span>
            <textarea value={form.setup} maxLength={400} onChange={event => set("setup")(event.target.value)} />
          </label>
          <ListEditor
            label="Steps (1–12, one action each, imperative)"
            values={form.steps}
            maxEntries={12}
            maxChars={240}
            onChange={set("steps")}
          />
        </div>
      </section>

      <div className="admin-grid-two">
        <section className="admin-card">
          <h3>Coach comments</h3>
          <p className="admin-note">Athlete-facing: cues, then the success criterion, then any safety note.</p>
          <ListEditor label="" values={form.coachComments} maxEntries={8} maxChars={200} onChange={set("coachComments")} />
        </section>
        <section className="admin-card">
          <h3>Adaptive levers</h3>
          <p className="admin-note">Not athlete-facing. Prefix with “Easier:”, “Harder:” or “Lever:”.</p>
          <ListEditor label="" values={form.adaptiveLevers} maxEntries={6} maxChars={200} onChange={set("adaptiveLevers")} />
        </section>
      </div>

      {errors.length > 0 && (
        <ul className="admin-issues">
          {errors.map((error, index) => <li key={index} className="admin-issue error">{error}</li>)}
        </ul>
      )}

      <div className="admin-form-actions">
        <Link className="quiet-button" to={mode === "create" ? "/admin/drills" : `/admin/drills/${drillId}`}>Cancel</Link>
        <button className="primary-cta" type="button" disabled={saving || errors.length > 0} onClick={save}>
          {saving ? "Saving…" : mode === "create" ? "Create drill" : "Save drill"}
        </button>
      </div>

      {mode === "edit" && drill && (
        <section className="admin-card">
          <h3>Media</h3>
          <p className="admin-note">
            Uploads land at <code>drillCatalogMedia/app/{drillId}/&lt;slot&gt;</code> and are approved on
            arrival — you are the approver. Existing portal clips stay where they are and keep playing.
          </p>
          <div className="admin-media-grid">
            {MEDIA_SLOTS.map(slot => (
              <MediaUploader
                key={slot}
                drillId={drillId}
                slot={slot}
                asset={(drill.media as any)?.[slot]}
                onChanged={() => loadDrill(drillId).then(found => found && setDrill(found))}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ListEditor({ label, values, maxEntries, maxChars, onChange }: {
  label: string;
  values: string[];
  maxEntries: number;
  maxChars: number;
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="admin-field">
      {label && <span>{label}</span>}
      <div className="admin-list-editor">
        {values.map((value, index) => (
          <div className="admin-list-row" key={index}>
            <input
              value={value}
              maxLength={maxChars}
              onChange={event => onChange(values.map((entry, position) => position === index ? event.target.value : entry))}
            />
            <button
              className="icon-button danger"
              type="button"
              aria-label={`Remove entry ${index + 1}`}
              onClick={() => onChange(values.filter((_, position) => position !== index))}
            >
              <span className="material-symbols-outlined">delete</span>
            </button>
          </div>
        ))}
        <button
          className="quiet-button"
          type="button"
          disabled={values.length >= maxEntries}
          onClick={() => onChange([...values, ""])}
        >
          <span className="material-symbols-outlined">add</span>Add
        </button>
      </div>
    </div>
  );
}

function MediaUploader({ drillId, slot, asset, onChanged }: {
  drillId: string;
  slot: MediaSlot;
  asset: any;
  onChanged: () => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | null) {
    if (!file) return;
    const problems = mediaFileErrors(slot, file);
    if (problems.length) { setError(problems[0]); return; }
    setError(null);
    setProgress(0);
    try {
      const handle = uploadDrillMedia(drillId, slot, file, setProgress);
      await handle.promise;
      onChanged();
    } catch (uploadError: any) {
      setError(uploadError?.message || "That upload did not finish.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="admin-media-slot">
      <header>
        <h4>{MEDIA_SLOT_LABELS[slot]}</h4>
        {asset?.storagePath && <span className="admin-chip accent">present</span>}
      </header>
      <p className="admin-note">{asset?.storagePath || "Empty"}</p>
      <label className="admin-field">
        <span>{slot === "birdsEye" ? "MP4, MOV or a JPEG/PNG still" : "MP4 or MOV, ≤ 90 s, ≤ 1080p"}</span>
        <input
          type="file"
          accept={slot === "birdsEye" ? "video/mp4,video/quicktime,image/jpeg,image/png" : "video/mp4,video/quicktime"}
          onChange={event => pick(event.target.files?.[0] ?? null)}
        />
      </label>
      {progress !== null && (
        <div className="admin-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      )}
      {error && <p className="form-message" role="alert">{error}</p>}
      {asset?.storagePath && String(asset.storagePath).startsWith("drillCatalogMedia/app/") && (
        <button
          className="quiet-button"
          type="button"
          onClick={async () => {
            if (!window.confirm(`Remove the ${MEDIA_SLOT_LABELS[slot]} clip?`)) return;
            await removeDrillMedia(drillId, slot, String(asset.storagePath));
            onChanged();
          }}
        >
          <span className="material-symbols-outlined">delete</span>Remove this clip
        </button>
      )}
    </div>
  );
}
