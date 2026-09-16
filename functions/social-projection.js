"use strict";

const { createHash } = require("node:crypto");
const idFor = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const sameSummary = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const millis = value => {
  const n = value?.toMillis?.() ?? (typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const clean = (value, max = 100) => typeof value === "string" ? value.trim().slice(0, max) : "";
const nameOf = p => [clean(p.firstName), clean(p.lastName)].filter(Boolean).join(" ") || "Athlete";
const ownerUid = (p, id) => {
  const fields = ["authenticationUID", "userUID"].filter(k => Object.hasOwn(p, k));
  if (fields.length && fields.every(k => typeof p[k] === "string" && p[k] && p[k] === p[fields[0]])) return p[fields[0]];
  return fields.length ? null : (p.registered === true ? id : null);
};
const DRILLS = {
  shooting: { title: "Shooting", field: "velocity", unit: "mph", factor: 2.23694, benchmark: "ballSpeed" },
  sprint: { title: "Sprint", field: "max_velocity", fallback: "maxVelocity", unit: "mph", factor: 2.23694, benchmark: "sprintCompletionTime", scoreField: "totalTime", lowerScore: true },
  jump: { title: "Vertical jump", field: "jumpHeight", unit: "in", factor: 39.37007874, benchmark: "verticalJumpHeight" },
  broadJump: { title: "Broad jump", field: "broadJumpDistance", unit: "ft", factor: 3.28084, benchmark: "broadJumpDistance" },
  dribbling: { title: "Dribbling", field: "totalTime", unit: "s", factor: 1, lower: true, benchmark: "dribbleTotalTime" },
  changeOfDirection: { title: "Agility", field: "totalTime", unit: "s", factor: 1, lower: true, benchmark: "codTotalTime" },
};
const drillKey = r => ({ side_kick: "shooting", deadballShot: "shooting", staticJump: "jump" })[r.repType || r.drillType] || r.repType || r.drillType;
function sessionKey(r) {
  const type = drillKey(r);
  const session = clean(r.sessionId, 128) || clean(r.sessionFolder, 128) || (Number.isSafeInteger(r.sessionNumber) && r.sessionNumber > 0 ? `session${r.sessionNumber}` : null);
  return DRILLS[type] && session ? `${type}:${session}` : null;
}
function benchmarkCell(p, now) {
  let age = typeof p.age === "number" ? Math.trunc(p.age) : null;
  const born = millis(p.birthDate || p.dateOfBirth);
  if (age === null && born) { const b = new Date(born), n = new Date(now); age = n.getUTCFullYear() - b.getUTCFullYear() - (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate()) ? 1 : 0); }
  const band = age === null ? "senior" : age < 13 ? "u12" : age < 15 ? "u14" : age < 17 ? "u16" : age < 19 ? "u18" : "senior";
  const raw = String(p.gender || "").toLowerCase();
  return `${band}|${["m", "male", "boy"].includes(raw) ? "male" : ["f", "female", "girl"].includes(raw) ? "female" : "unspecified"}`;
}
function projectActivities(playerId, p, reps, logs, sessions, dataset = {}, now = Date.now()) {
  const result = [], groups = new Map(), covered = new Set();
  const base = { playerId, authorUid: ownerUid(p, playerId), organizationId: clean(p.organizationId, 128), teamId: clean(p.teamId, 128), authorName: nameOf(p), schemaVersion: 1 };
  const audiences = [`player:${playerId}`, ...(base.organizationId ? [`org:${base.organizationId}`] : []), ...(base.teamId ? [`team:${base.teamId}`] : [])];
  for (const log of logs) {
    const ended = millis(log.endedAt);
    if (!ended || ended > now) continue;
    const blocks = (Array.isArray(log.blocks) ? log.blocks : []).filter(b => ["done", "partial"].includes(b.status));
    if (!blocks.length) continue;
    const snap = log.workoutSnapshot || {};
    const linked = sessions.find(s => s.id === log.linkedTrainingSessionId);
    for (const ref of linked?.sessionRefs || []) {
      if (ref.sessionDocId) covered.add(`${drillKey({ repType: ref.drillType })}:${ref.sessionDocId}`);
      if (ref.sessionNumber) covered.add(`${drillKey({ repType: ref.drillType })}:session${ref.sessionNumber}`);
    }
    const sets = blocks.reduce((sum, b) => sum + Math.max(0, Number.isSafeInteger(b.setsCompleted) ? b.setsCompleted : 0), 0);
    const drills = blocks.map(b => clean((snap.blocks || []).find(x => x.blockId === b.blockId)?.name || b.name || b.drillId)).filter(Boolean);
    result.push({ ...base, id: idFor(playerId, "workout", log.id), kind: "workout", sourceId: log.id, audiences, occurredAt: ended, availableAt: ended,
      title: clean(snap.title || snap.name || snap.intent, 140) || "Training workout", subtitle: drills.join(" · ").slice(0, 500),
      metrics: [{ label: "Drills", value: blocks.length, unit: "" }, { label: "Sets", value: sets, unit: "" }, ...(positive(log.activeSeconds) ? [{ label: "Active time", value: Math.round(log.activeSeconds / 60), unit: "min" }] : [])],
      repIds: [], drill: null, score: null, scoreGeneration: null, partial: log.endReason !== "completed", chart: [] });
  }
  for (const rep of reps) {
    const key = sessionKey(rep), date = millis(rep.createdAt || rep.createdAtMillis || rep.timestamp), drill = DRILLS[drillKey(rep)];
    if (!key || !date || date > now || !drill || !(positive(rep[drill.field]) || positive(rep[drill.fallback]))) continue;
    if (covered.has(key) || covered.has(`${drillKey(rep)}:session${rep.sessionNumber}`)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...rep, date });
  }
  for (const [key, rows] of groups) {
    rows.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
    const drill = drillKey(rows[0]), def = DRILLS[drill], values = rows.map(r => (positive(r[def.field]) || positive(r[def.fallback])) * def.factor);
    const occurredAt = rows[rows.length - 1].date;
    const rawScores = rows.map(r => positive(r[def.scoreField || def.field]) || positive(r[def.fallback])).filter(Boolean);
    const reference = positive(dataset.cells?.[benchmarkCell(p, now)]?.[def.benchmark]?.percentiles?.p50);
    const bestScore = rawScores.length ? (def.lower || def.lowerScore ? Math.min(...rawScores) : Math.max(...rawScores)) : null;
    result.push({ ...base, id: idFor(playerId, "session", key), kind: "session", sourceId: key, audiences, occurredAt,
      // Processed reps are settled after five quiet minutes. No live-workout claims.
      availableAt: occurredAt + 300000, title: `${def.title} session`, subtitle: `${rows.length} measured reps`, drill,
      metrics: [{ label: "Reps", value: rows.length, unit: "" }, { label: "Best", value: def.lower ? Math.min(...values) : Math.max(...values), unit: def.unit }, { label: "Average", value: values.reduce((a, b) => a + b, 0) / values.length, unit: def.unit }],
      score: reference && bestScore ? 100 * (def.lower || def.lowerScore ? reference / bestScore : bestScore / reference) : null,
      scoreGeneration: dataset.generation || null, repIds: rows.map(r => r.id), chart: values.slice(-30), partial: false });
  }
  return result;
}
module.exports = { idFor, millis, positive, clean, nameOf, ownerUid, drillKey, sessionKey, projectActivities, sameSummary };
