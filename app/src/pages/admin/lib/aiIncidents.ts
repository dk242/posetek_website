// AI incidents — the data layer behind /admin/ai-incidents and the athlete
// page's AI section. AI_OBSERVABILITY_AND_IMPROVEMENT_PLAN §3.4 (mobile repo,
// docs/plans/), with the record shape from §3.1 and contract §16.
//
// One bounded read, newest first, filtered and grouped client-side like the
// drill library: incidents are well under 50 a day, so 500 documents is weeks
// of history and a query per filter change would cost more than it saves.
// normalize / group are a port of failureDashboard.html's, without its
// innerHTML: every string here ends up as a JSX text node, never markup.
//
// Privacy (§2): an incident carries codes, ids, lengths and redacted error
// text, never athlete message text or model output. Nothing here adds any —
// the llmJobs summary below keeps only status, times and the error code,
// because `llmJobs.error.message` can quote model output (G15).

/* eslint-disable @typescript-eslint/no-explicit-any */

import firebase, { auth, db } from "../../../lib/firebase";

export const INCIDENT_COLLECTION = "aiIncidents";
export const INCIDENT_LIMIT = 500;
export const PLAYER_INCIDENT_LIMIT = 10;
export const PACIFIC = "America/Los_Angeles";
export const LOG_PROJECT = "kickai-69dd0";
/** A job still pending or running this long after creation is stuck (§9). */
export const STUCK_JOB_MINUTES = 30;
export const STUCK_JOB_LIMIT = 100;

export const TRIAGE_STATES = ["new", "fixed", "verified", "wontfix"] as const;
export type TriageState = typeof TRIAGE_STATES[number];
export const TRIAGE_LABELS: Record<TriageState, string> = {
  new: "New", fixed: "Fixed", verified: "Verified", wontfix: "Won't fix",
};
// The rules' caps (firebase/firestore.rules, aiIncidents validTriageUpdate).
export const TRIAGE_NOTE_MAX = 1000;
export const TRIAGE_FIX_REF_MAX = 200;
export const TRIAGE_REPLAY_NOTE_MAX = 1000;
export const TRIAGE_OWNER_MAX = 120;

export interface Triage {
  state: TriageState;
  owner: string;
  note: string;
  fixRef: string;
  replayNote: string;
  updatedAt: Date | null;
  updatedBy: string;
}

export interface DegradedSignal { signal: string; detail: string }

export interface AiIncident {
  id: string;
  source: string;
  transport: string;
  kind: string;
  severity: string;
  capability: string;
  code: string;
  stage: string;
  message: string;
  playerId: string;
  requestedByUid: string;
  clientVersion: string;
  platform: string;
  isTest: boolean;
  backfill: boolean;
  requestId: string;
  requestIdSource: string;
  jobId: string;
  conversationId: string;
  messageId: string;
  draftId: string;
  invocationId: string;
  gatewayRevision: string;
  traceRef: string;
  httpStatus: number | null;
  providerStatus: string;
  provider: string;
  model: string;
  latencyMs: number | null;
  providerCalls: number | null;
  allowance: Record<string, unknown> | null;
  quota: Record<string, unknown> | null;
  degraded: DegradedSignal[];
  messageLength: number | null;
  /** The phone's half: its own map, or the one the fold merged in. */
  client: Record<string, unknown> | null;
  userReport: { note: string; submittedAt: Date | null } | null;
  hasClient: boolean;
  clientIncidentIds: string[];
  foldedInto: string;
  foldRejected: string;
  occurredAt: Date | null;
  createdAt: Date | null;
  triage: Triage;
}

// MARK: - Normalize

const str = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const map = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) && !isTimestamp(value) ? value as Record<string, unknown> : null;

function isTimestamp(value: any): boolean {
  return Boolean(value) && (typeof value.toDate === "function" || value instanceof Date);
}

/** Firestore Timestamp, Date, or an ISO/epoch value → Date; anything else → null. */
export function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.valueOf()) ? date : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1e6));
  return null;
}

function triageOf(value: unknown): Triage {
  const raw = map(value) ?? {};
  const state = TRIAGE_STATES.includes(raw.state as TriageState) ? raw.state as TriageState : "new";
  return {
    state,
    owner: str(raw.owner),
    note: str(raw.note),
    fixRef: str(raw.fixRef),
    replayNote: str(raw.replayNote),
    updatedAt: toDate(raw.updatedAt),
    updatedBy: str(raw.updatedBy),
  };
}

export function normalizeIncident(id: string, data: any): AiIncident {
  const d = data && typeof data === "object" ? data : {};
  const report = map(d.userReport);
  return {
    id,
    source: str(d.source) || "unknown",
    transport: str(d.transport) || "unknown",
    kind: str(d.kind) || "unknown",
    severity: str(d.severity),
    capability: str(d.capability) || "unknown",
    code: str(d.code) || "unknown",
    stage: str(d.stage) || "unknown",
    message: str(d.message),
    playerId: str(d.playerId),
    requestedByUid: str(d.requestedByUid),
    clientVersion: str(d.clientVersion),
    platform: str(d.platform),
    isTest: d.isTest === true,
    backfill: d.backfill === true,
    requestId: str(d.requestId),
    requestIdSource: str(d.requestIdSource),
    jobId: str(d.jobId),
    conversationId: str(d.conversationId),
    messageId: str(d.messageId),
    draftId: str(d.draftId),
    invocationId: str(d.invocationId),
    gatewayRevision: str(d.gatewayRevision),
    traceRef: str(d.traceRef),
    httpStatus: num(d.httpStatus),
    providerStatus: str(d.providerStatus),
    provider: str(d.provider),
    model: str(d.model),
    latencyMs: num(d.latencyMs),
    providerCalls: num(d.providerCalls),
    allowance: map(d.allowance),
    quota: map(d.quota),
    degraded: Array.isArray(d.degraded)
      ? d.degraded.map((entry: any) => ({ signal: str(entry?.signal) || "unknown", detail: str(entry?.detail) }))
      : [],
    messageLength: num(d.messageLength),
    client: map(d.client),
    userReport: report ? { note: str(report.note), submittedAt: toDate(report.submittedAt) } : null,
    hasClient: d.hasClient === true || Boolean(map(d.client)),
    clientIncidentIds: Array.isArray(d.clientIncidentIds) ? d.clientIncidentIds.map(str).filter(Boolean) : [],
    foldedInto: str(d.foldedInto),
    foldRejected: str(d.foldRejected),
    occurredAt: toDate(d.occurredAt),
    createdAt: toDate(d.createdAt),
    triage: triageOf(d.triage),
  };
}

/** When it happened: the writer's occurrence time, else the server receipt. */
export const whenOf = (incident: AiIncident): Date | null => incident.occurredAt ?? incident.createdAt;

/**
 * A phone half the fold merged into a canonical `req-`/`job-` doc is part of
 * that incident, not a second one (§2 "exactly one countable"). It is hidden
 * only when its canonical doc is in the loaded window, so a half whose
 * canonical fell outside the 500 never silently disappears.
 */
export function countable(incidents: AiIncident[]): AiIncident[] {
  const ids = new Set(incidents.map(incident => incident.id));
  return incidents.filter(incident => !(incident.foldedInto && ids.has(incident.foldedInto)));
}

// MARK: - Pacific time (§3.4: every timestamp renders in Pacific; `day` is UTC and never shown)

const PACIFIC_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit",
});
const PACIFIC_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
  timeZoneName: "short",
});
const PACIFIC_SHORT = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

/** YYYY-MM-DD of the instant in America/Los_Angeles. */
export function pacificDate(date: Date): string {
  const parts = Object.fromEntries(PACIFIC_PARTS.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** "Sep 23, 5:14:38 PM PDT" — seconds and zone, for the drawer. */
export const pacificTime = (date: Date | null): string => (date ? PACIFIC_TIME.format(date) : "—");
/** "Sep 23, 5:14 PM" — for list rows, under a heading that says Pacific. */
export const pacificShort = (date: Date | null): string => (date ? PACIFIC_SHORT.format(date) : "—");

// MARK: - Filters and search

export interface IncidentFilters {
  capability: string;
  code: string;
  kind: string;
  source: string;
  /** "athletes" hides server-labelled test traffic; "test" shows only it. */
  test: "athletes" | "test" | "all";
  triage: string;
  /** Pacific calendar dates, inclusive, YYYY-MM-DD or "". */
  from: string;
  to: string;
  search: string;
}

export const EMPTY_FILTERS: IncidentFilters = {
  capability: "", code: "", kind: "", source: "", test: "athletes", triage: "", from: "", to: "", search: "",
};

/** Player-name → ids, from the Monitor-accounts player index plus per-row lookups. */
export type PlayerNames = Map<string, string>;

/**
 * The search box matches, case-insensitively: the incident id, the requestId
 * (a prefix is enough — the phone's 8-character ref code is its head), the
 * jobId, conversationId, playerId and uid, and the athlete's name.
 */
export function matchesSearch(incident: AiIncident, term: string, names: PlayerNames): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const ids = [incident.id, incident.requestId, incident.jobId, incident.conversationId, incident.playerId,
    incident.requestedByUid, incident.draftId, ...incident.clientIncidentIds].map(value => value.toLowerCase());
  if (ids.some(value => value && (value.startsWith(needle) || (needle.length >= 6 && value.includes(needle))))) return true;
  if (needle.length < 2) return false;
  const name = names.get(incident.playerId);
  return Boolean(name && name.toLowerCase().includes(needle));
}

export function applyFilters(incidents: AiIncident[], filters: IncidentFilters, names: PlayerNames): AiIncident[] {
  return incidents.filter(incident => {
    if (filters.capability && incident.capability !== filters.capability) return false;
    if (filters.code && incident.code !== filters.code) return false;
    if (filters.kind && incident.kind !== filters.kind) return false;
    if (filters.source && incident.source !== filters.source) return false;
    if (filters.test === "athletes" && incident.isTest) return false;
    if (filters.test === "test" && !incident.isTest) return false;
    if (filters.triage && incident.triage.state !== filters.triage) return false;
    if (filters.from || filters.to) {
      const when = whenOf(incident);
      if (!when) return false;
      const day = pacificDate(when);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
    }
    return matchesSearch(incident, filters.search, names);
  });
}

/** Distinct values of one field, most frequent first, for the filter menus. */
export function facetValues(incidents: AiIncident[], field: "capability" | "code" | "kind" | "source"): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const incident of incidents) counts.set(incident[field], (counts.get(incident[field]) ?? 0) + 1);
  return [...counts.entries()].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// MARK: - Group-by breakdown (failureDashboard.html's groupInfo/renderBreakdown)

export const GROUP_MODES = ["code", "capability", "stage", "kind", "source", "day", "class"] as const;
export type GroupMode = typeof GROUP_MODES[number];
export const GROUP_LABELS: Record<GroupMode, string> = {
  code: "Code", capability: "Capability", stage: "Stage", kind: "Kind", source: "Source",
  day: "Day (Pacific)", class: "Capability × code × stage",
};

/** value = what a click filters on ("" when a bar is not a filter); label = the display text. */
export function groupInfo(incident: AiIncident, mode: GroupMode): { value: string; label: string } {
  switch (mode) {
    case "capability": return { value: incident.capability, label: incident.capability };
    case "stage": return { value: "", label: incident.stage };
    case "kind": return { value: incident.kind, label: incident.kind };
    case "source": return { value: incident.source, label: incident.source };
    case "day": {
      const when = whenOf(incident);
      return when ? { value: pacificDate(when), label: pacificDate(when) } : { value: "", label: "no date" };
    }
    // The §5 triage class: a new incident matching a verified class reopens it.
    case "class": return { value: "", label: `${incident.capability} · ${incident.code} · ${incident.stage}` };
    default: return { value: incident.code, label: incident.code };
  }
}

export interface GroupRow { label: string; value: string; count: number; newest: Date | null }

export function groupBreakdown(incidents: AiIncident[], mode: GroupMode): GroupRow[] {
  const rows = new Map<string, GroupRow>();
  for (const incident of incidents) {
    const { value, label } = groupInfo(incident, mode);
    const row = rows.get(label) ?? { label, value, count: 0, newest: null };
    row.count += 1;
    const when = whenOf(incident);
    if (when && (!row.newest || when > row.newest)) row.newest = when;
    rows.set(label, row);
  }
  // Days read chronologically (newest first); everything else by size.
  return [...rows.values()].sort(mode === "day"
    ? (a, b) => b.label.localeCompare(a.label)
    : (a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// MARK: - Links

const LOG_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HOUR_MS = 60 * 60 * 1000;

/**
 * A Logs Explorer link prefilled on `labels.requestId` (and `labels.jobId`
 * for jobs, which the gateway's job lines also carry), over a two-hour window
 * around the incident. The window is a `timestamp` clause inside the query —
 * the documented way to pin a range; Logs Explorer then disables its own time
 * selector — rather than an undocumented URL parameter. OR binds tighter than
 * AND in the Logging query language; the parentheses are for the reader. Ids
 * are interpolated into a quoted query, so anything outside the id alphabet
 * gets no link rather than an escaped one.
 */
export function loggingLink(incident: AiIncident): string | null {
  const ids = [...new Set([incident.requestId, incident.jobId].filter(id => LOG_ID.test(id)))];
  if (!ids.length) return null;
  const clauses = [`(${ids.flatMap(id => [`labels.requestId="${id}"`, `labels.jobId="${id}"`]).join(" OR ")})`];
  const when = whenOf(incident);
  if (when) {
    clauses.push(`timestamp>="${new Date(when.valueOf() - HOUR_MS).toISOString()}"`);
    clauses.push(`timestamp<="${new Date(when.valueOf() + HOUR_MS).toISOString()}"`);
  }
  return `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(clauses.join(" AND "))}?project=${LOG_PROJECT}`;
}

/** The Cloud Storage console page for a `gs://bucket/path` trace ref. */
export function traceLink(traceRef: string): string | null {
  const match = /^gs:\/\/([a-z0-9][a-z0-9._-]{1,220})\/([^?#]+)$/.exec(traceRef);
  if (!match || match[2].split("/").some(part => part === ".." || part === ".")) return null;
  const path = match[2].split("/").map(encodeURIComponent).join("/");
  return `https://console.cloud.google.com/storage/browser/_details/${match[1]}/${path}?project=${LOG_PROJECT}`;
}

/** Deep link into this page with one incident's drawer open. */
export const incidentPath = (id: string): string => `/admin/ai-incidents?incident=${encodeURIComponent(id)}`;
/** This page searched to one athlete. */
export const playerIncidentsPath = (playerId: string): string => `/admin/ai-incidents?q=${encodeURIComponent(playerId)}`;

// MARK: - Display helpers for maps the writers own

/**
 * A flat, ordered list of [key, text] for a map such as `client` or
 * `allowance`. Values become plain strings — the caller renders them as text
 * nodes — and nested maps are flattened to dotted keys one level deep.
 */
export function fieldRows(value: Record<string, unknown> | null, order: string[] = []): [string, string][] {
  if (!value) return [];
  const keys = [...order.filter(key => key in value), ...Object.keys(value).filter(key => !order.includes(key)).sort()];
  const rows: [string, string][] = [];
  for (const key of keys) {
    const entry = value[key];
    if (entry === null || entry === undefined || entry === "") continue;
    const nested = map(entry);
    if (nested) {
      for (const [inner, text] of fieldRows(nested)) rows.push([`${key}.${inner}`, text]);
    } else {
      rows.push([key, display(entry)]);
    }
  }
  return rows;
}

function display(value: unknown): string {
  if (isTimestamp(value)) return pacificTime(toDate(value));
  if (Array.isArray(value)) return value.map(display).join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/** Order the §3.1 `client` map the way a reader wants it. */
export const CLIENT_FIELD_ORDER = [
  "userSaw", "errorCode", "firestoreCode", "underlyingDomain", "underlyingCode", "detail", "surface",
  "retryOffered", "actionTaken", "previousErrorCode", "previousRequestId", "online", "sessionState",
  "pointer", "identityResolution", "workoutTarget", "appVersion", "build", "iosVersion", "deviceModel",
  "timeZone", "occurredAtLocal", "launchId", "breadcrumbTail",
];
export const ALLOWANCE_FIELD_ORDER = ["gate", "bucket", "used", "limit", "day"];

// MARK: - Triage

export interface TriageDraft { state: TriageState; owner: string; note: string; fixRef: string; replayNote: string }

export const draftOf = (triage: Triage): TriageDraft => ({
  state: triage.state, owner: triage.owner, note: triage.note, fixRef: triage.fixRef, replayNote: triage.replayNote,
});

/**
 * Why this triage cannot be saved, or null. Mirrors the rules: `fixed` needs a
 * pointer to the fix, `verified` needs the replay note (§5: the incident id the
 * replay produced, or a dated "replay produced no incident").
 */
export function triageProblem(draft: TriageDraft): string | null {
  if (!TRIAGE_STATES.includes(draft.state)) return "Choose a triage state.";
  if (draft.state === "fixed" && !draft.fixRef.trim()) {
    return "A fixed incident needs a fix reference: the commit, PR or config change that fixes it.";
  }
  if (draft.state === "verified" && !draft.replayNote.trim()) {
    return "A verified incident needs a replay note: the incident id the replay produced, or a dated \"replay produced no incident\".";
  }
  if (draft.fixRef.trim().length > TRIAGE_FIX_REF_MAX) return `Keep the fix reference under ${TRIAGE_FIX_REF_MAX} characters.`;
  if (draft.replayNote.trim().length > TRIAGE_REPLAY_NOTE_MAX) return `Keep the replay note under ${TRIAGE_REPLAY_NOTE_MAX} characters.`;
  if (draft.note.trim().length > TRIAGE_NOTE_MAX) return `Keep the note under ${TRIAGE_NOTE_MAX} characters.`;
  if (draft.owner.trim().length > TRIAGE_OWNER_MAX) return `Keep the owner under ${TRIAGE_OWNER_MAX} characters.`;
  return null;
}

/** The `triage` map the rules accept: only their keys, empty strings omitted. */
export function triagePayload(draft: TriageDraft, updatedBy: string, updatedAt: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = { state: draft.state, updatedAt, updatedBy };
  for (const key of ["owner", "note", "fixRef", "replayNote"] as const) {
    const value = draft[key].trim();
    if (value) payload[key] = value;
  }
  return payload;
}

// MARK: - Firestore

export async function loadIncidents(): Promise<AiIncident[]> {
  const snapshot = await db.collection(INCIDENT_COLLECTION).orderBy("createdAt", "desc").limit(INCIDENT_LIMIT).get();
  return snapshot.docs.map(doc => normalizeIncident(doc.id, doc.data()));
}

export async function loadIncident(id: string): Promise<AiIncident | null> {
  const doc = await db.collection(INCIDENT_COLLECTION).doc(id).get();
  return doc.exists ? normalizeIncident(doc.id, doc.data()) : null;
}

/** One athlete's newest incidents; uses the (playerId, createdAt desc) index. */
export async function loadPlayerIncidents(playerId: string): Promise<AiIncident[]> {
  const snapshot = await db.collection(INCIDENT_COLLECTION).where("playerId", "==", playerId)
    .orderBy("createdAt", "desc").limit(PLAYER_INCIDENT_LIMIT).get();
  return countable(snapshot.docs.map(doc => normalizeIncident(doc.id, doc.data())));
}

/**
 * Admin-only update confined to `triage` — the one field the rules let a
 * person write. Returns the triage as saved, with a local clock for the time.
 */
export async function saveTriage(id: string, draft: TriageDraft): Promise<Triage> {
  const problem = triageProblem(draft);
  if (problem) throw new Error(problem);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in again to save triage.");
  const payload = triagePayload(draft, uid, firebase.firestore.FieldValue.serverTimestamp());
  await db.collection(INCIDENT_COLLECTION).doc(id).update({ triage: payload });
  return triageOf({ ...payload, updatedAt: new Date() });
}

export interface JobSummary {
  id: string;
  status: string;
  capability: string;
  playerId: string;
  clientVersion: string;
  errorCode: string;
  paramKeys: string[];
  hasResult: boolean;
  traceRef: string;
  createdAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** An allowlisted view of an llmJobs doc: no params values, no result, no error text (G15). */
export function jobSummary(id: string, data: any): JobSummary {
  const d = data && typeof data === "object" ? data : {};
  return {
    id,
    status: str(d.status) || "unknown",
    capability: str(d.capability),
    playerId: str(d.playerId),
    clientVersion: str(d.clientVersion),
    errorCode: str(d.error?.code),
    paramKeys: map(d.params) ? Object.keys(d.params).sort() : [],
    hasResult: d.result !== undefined && d.result !== null,
    traceRef: str(d.traceRef),
    createdAt: toDate(d.createdAt),
    startedAt: toDate(d.startedAt),
    completedAt: toDate(d.completedAt),
  };
}

export async function loadJob(jobId: string): Promise<JobSummary | null> {
  const doc = await db.collection("llmJobs").doc(jobId).get();
  return doc.exists ? jobSummary(doc.id, doc.data()) : null;
}

export function isStuck(job: JobSummary, now: number = Date.now()): boolean {
  return (job.status === "pending" || job.status === "running")
    && job.createdAt !== null && now - job.createdAt.valueOf() >= STUCK_JOB_MINUTES * 60 * 1000;
}

/**
 * Jobs still pending or running after 30 minutes — the vanished/never-picked-up
 * and stuck-`running` classes (§9) that never become a failed job, so neither
 * the gateway nor the projection records them. Uses the (status, createdAt desc) index.
 */
export async function loadStuckJobs(now: number = Date.now()): Promise<{ jobs: JobSummary[]; truncated: boolean }> {
  const snapshot = await db.collection("llmJobs").where("status", "in", ["pending", "running"])
    .orderBy("createdAt", "desc").limit(STUCK_JOB_LIMIT + 1).get();
  const jobs = snapshot.docs.slice(0, STUCK_JOB_LIMIT).map(doc => jobSummary(doc.id, doc.data()));
  return { jobs: jobs.filter(job => isStuck(job, now)), truncated: snapshot.docs.length > STUCK_JOB_LIMIT };
}

/** A sentence for a failed read, naming the permission case (rules not yet live) plainly. */
export function readError(error: any, what: string): string {
  if (error?.code === "permission-denied") {
    return `${what} could not be read: permission denied. Admin reads of aiIncidents and llmJobs come from the rules cutover; if it has not published yet, this is expected.`;
  }
  if (error?.code === "failed-precondition") return `${what} could not be read: the query needs an index that is not built yet.`;
  return `${what} could not be read: ${error?.message || "unknown error"}.`;
}
