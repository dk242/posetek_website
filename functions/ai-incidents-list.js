"use strict";

const { createHash } = require("node:crypto");
const { isClubAdmin } = require("./club-access");
const LIMIT = 50, SCAN_PAGE = 250, MAX_SCAN = 50000;
const PACIFIC = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
const FIELDS = ["source", "transport", "kind", "severity", "capability", "code", "stage", "message", "playerId", "requestedByUid", "clientVersion", "platform", "isTest", "backfill", "requestId", "requestIdSource", "jobId", "conversationId", "messageId", "draftId", "invocationId", "gatewayRevision", "traceRef", "httpStatus", "providerStatus", "provider", "model", "latencyMs", "providerCalls", "allowance", "quota", "degraded", "messageLength", "client", "userReport", "hasClient", "clientIncidentIds", "foldedInto", "foldRejected", "occurredAt", "createdAt", "triage"];
const CLIENT_FIELDS = ["userSaw", "errorCode", "firestoreCode", "underlyingDomain", "underlyingCode", "detail", "surface", "retryOffered", "actionTaken", "previousErrorCode", "previousRequestId", "online", "sessionState", "pointer", "identityResolution", "workoutTarget", "appVersion", "build", "iosVersion", "deviceModel", "timeZone", "occurredAtLocal", "launchId", "breadcrumbTail"];
const asMillis = value => value && typeof value.toMillis === "function" ? value.toMillis()
  : value instanceof Date ? value.getTime() : typeof value === "number" ? value : null;
const stamp = value => { const millis = asMillis(value); return millis === null ? null : new Date(millis).toISOString(); };
const dateOf = value => {
  const at = asMillis(value);
  if (at === null) return "";
  const parts = Object.fromEntries(PACIFIC.formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const text = value => typeof value === "string" ? value : "";
const safe = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
function safeValue(value, depth = 0) {
  if (typeof value === "string") return value.slice(0, 1024);
  if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  if (depth >= 2) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => safeValue(item, depth + 1));
  if (value && typeof value === "object" && !value.toDate) return Object.fromEntries(Object.entries(value).slice(0, 20)
    .filter(([key]) => /^[A-Za-z][A-Za-z0-9_-]{0,50}$/.test(key)).map(([key, entry]) => [key, safeValue(entry, depth + 1)]));
  return null;
}
function publicIncident(id, raw, isTest) {
  const data = {};
  for (const field of FIELDS) if (Object.hasOwn(raw, field)) data[field] = raw[field];
  for (const field of FIELDS) if (typeof data[field] === "string") data[field] = data[field].slice(0, 1024);
  data.isTest = isTest;
  data.clientIncidentIds = Array.isArray(data.clientIncidentIds) ? data.clientIncidentIds.slice(0, 20).map(value => text(value).slice(0, 200)) : [];
  data.message = text(data.message).slice(0, 512);
  const client = Object.fromEntries(CLIENT_FIELDS.filter(field => Object.hasOwn(safe(data.client), field))
    .map(field => [field, safeValue(data.client[field])]));
  data.client = Object.keys(client).length ? client : null;
  for (const field of ["allowance", "quota"]) data[field] = safeValue(data[field]);
  data.degraded = Array.isArray(data.degraded) ? data.degraded.slice(0, 20).map(entry => ({ signal: text(entry?.signal).slice(0, 120), detail: text(entry?.detail).slice(0, 512) })) : [];
  for (const field of ["occurredAt", "createdAt"]) data[field] = stamp(data[field]);
  if (data.triage) data.triage = Object.fromEntries(["state", "owner", "note", "fixRef", "replayNote", "updatedBy"]
    .filter(field => Object.hasOwn(safe(data.triage), field)).map(field => [field, text(data.triage[field]).slice(0, 1000)]));
  if (data.triage) data.triage.updatedAt = stamp(raw.triage?.updatedAt);
  if (data.userReport) data.userReport = { note: text(data.userReport.note).slice(0, 1000), submittedAt: stamp(data.userReport.submittedAt) };
  return { id, data };
}
function normalizedFilters(input) {
  const raw = safe(input), fields = ["capability", "code", "kind", "source", "triage", "from", "to", "search"];
  const filters = Object.fromEntries(fields.map(field => [field, text(raw[field]).trim().slice(0, 120)]));
  filters.test = ["athletes", "test", "all"].includes(raw.test) ? raw.test : "athletes";
  for (const field of ["from", "to"]) if (filters[field] && !/^\d{4}-\d{2}-\d{2}$/.test(filters[field])) throw new Error(`Invalid ${field} date`);
  if (filters.from && filters.to && filters.from > filters.to) throw new Error("Invalid date range");
  return filters;
}
const compare = (a, b) => (b.sortAt - a.sortAt) || b.id.localeCompare(a.id);
const lower = value => text(value).toLowerCase();
function matchesSearch(row, term, name) {
  if (!term) return true;
  const ids = [row.id, row.data.requestId, row.data.jobId, row.data.conversationId, row.data.playerId,
    row.data.requestedByUid, row.data.draftId, ...(Array.isArray(row.data.clientIncidentIds) ? row.data.clientIncidentIds : [])];
  if (ids.some(value => lower(value).startsWith(term) || term.length >= 6 && lower(value).includes(term))) return true;
  return term.length >= 2 && lower(name).includes(term);
}
async function scan(db, collection, maximum = MAX_SCAN) {
  const rows = []; let after = null;
  while (true) {
    let query = db.collection(collection).orderBy("__name__").limit(SCAN_PAGE);
    if (after !== null) query = query.startAfter(after);
    const page = await query.get();
    rows.push(...page.docs);
    if (rows.length > maximum) throw new Error(`${collection} exceeds the complete reporting bound`);
    if (page.docs.length < SCAN_PAGE) return rows;
    after = page.docs.at(-1).id;
  }
}
function createAiIncidentList({ db, HttpsError }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  async function list(input, caller) {
    if (!isClubAdmin(caller)) fail("permission-denied", "Verified administrator required.");
    let filters;
    try { filters = normalizedFilters(input?.filters); } catch { fail("invalid-argument", "Choose valid incident filters."); }
    const group = ["code", "capability", "stage", "kind", "source", "day", "class"].includes(input?.group) ? input.group : "code";
    const fingerprint = createHash("sha256").update(JSON.stringify([caller.uid, filters, group])).digest("hex");
    let cursor = null;
    if (input?.cursor) {
      try {
        if (typeof input.cursor !== "string" || input.cursor.length > 2048) throw new Error();
        const parsed = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
        if (parsed.fingerprint !== fingerprint || !Number.isSafeInteger(parsed.at) || !/^[A-Za-z0-9_-]{1,200}$/.test(parsed.id)) throw new Error();
        cursor = parsed;
      } catch { fail("invalid-argument", "Incident filters changed. Return to the first page."); }
    }
    let snapshots;
    try { snapshots = await scan(db, "aiIncidents"); }
    catch (error) {
      if (/exceeds the complete reporting bound/.test(String(error?.message))) fail("resource-exhausted", "The complete incident history is too large to report.");
      throw error;
    }
    const testConfig = await db.collection("config").doc("llm").get();
    const testUids = new Set(Array.isArray(testConfig.data()?.testUids) ? testConfig.data().testUids : []);
    const rows = snapshots.filter(snapshot => !snapshot.data().foldedInto).map(snapshot => {
      const raw = snapshot.data(), uid = text(raw.requestedByUid);
      const isTest = Boolean(uid && testUids.has(uid)) || (raw.source !== "client" && raw.isTest === true);
      return { ...publicIncident(snapshot.id, raw, isTest), sortAt: asMillis(raw.createdAt) ?? -1,
        day: dateOf(raw.occurredAt || raw.createdAt) };
    });
    const term = filters.search.toLowerCase();
    const preselected = rows.filter(row => (!filters.capability || row.data.capability === filters.capability)
      && (!filters.code || row.data.code === filters.code) && (!filters.kind || row.data.kind === filters.kind)
      && (!filters.source || row.data.source === filters.source)
      && (filters.test === "all" || (filters.test === "test" ? row.data.isTest : !row.data.isTest))
      && (!filters.triage || (row.data.triage?.state || "new") === filters.triage)
      && (!filters.from || row.day >= filters.from) && (!filters.to || row.day <= filters.to));
    let names = new Map();
    if (term.length >= 2) {
      const playerIds = [...new Set(preselected.map(row => row.data.playerId).filter(Boolean))];
      if (playerIds.length > 5000) fail("resource-exhausted", "Name search exceeds its complete reporting bound.");
      const found = [];
      for (let offset = 0; offset < playerIds.length; offset += 20) {
        found.push(...await Promise.all(playerIds.slice(offset, offset + 20).map(id => db.collection("players").doc(id).get())));
      }
      names = new Map(found.filter(snap => snap.exists).map(snap => [snap.id, `${text(snap.data().firstName)} ${text(snap.data().lastName)}`.trim()]));
    }
    const base = preselected.filter(row => matchesSearch(row, term, names.get(row.data.playerId)));
    base.sort(compare);
    const valueOf = row => group === "day" ? row.day || "Unknown" : group === "class"
      ? `${row.data.capability || "unknown"} × ${row.data.code || "unknown"} × ${row.data.stage || "unknown"}`
      : text(row.data[group]) || "unknown";
    const breakdown = new Map();
    for (const row of base) { const label = valueOf(row); breakdown.set(label, (breakdown.get(label) || 0) + 1); }
    const facets = {};
    for (const field of ["capability", "code", "kind", "source"]) {
      const values = new Map();
      for (const row of rows) { const value = text(row.data[field]) || "unknown"; values.set(value, (values.get(value) || 0) + 1); }
      facets[field] = [...values].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    }
    const after = cursor ? base.filter(row => row.sortAt < cursor.at || row.sortAt === cursor.at && row.id < cursor.id) : base;
    const page = after.slice(0, LIMIT), last = page.at(-1);
    return { total: base.length, pageSize: LIMIT, rows: page.map(({ id, data, sortAt }) => ({ id, data, playerName: names.get(data.playerId) || "" })),
      nextCursor: after.length > LIMIT && last ? Buffer.from(JSON.stringify({ fingerprint, at: last.sortAt, id: last.id })).toString("base64url") : null,
      breakdown: [...breakdown].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)), facets };
  }
  return { list };
}

module.exports = { createAiIncidentList, normalizedFilters, matchesSearch, publicIncident, LIMIT };
