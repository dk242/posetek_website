"use strict";

// First-party estimated engagement. Client clocks are bounded evidence, never
// proof of physical exercise. Staff-selected players are not accepted as actors.
const crypto = require("node:crypto");
const { playerSegment } = require("./athlete-storage-paths");
const { isClubAdmin } = require("./club-access");
const DAY = 86400000;
const BIN_MS = 15 * 60000;
const FEATURES = ["workout", "video", "training", "results", "planner", "feed", "overview", "other"];
const PLATFORMS = ["web", "ios"];
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const millis = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : value);
const dayKey = value => new Date(value).toISOString().slice(0, 10);

function rangesUnion(ranges) {
  const sorted = ranges.filter(r => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[1] > r[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [start, end] of sorted) {
    const previous = out.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(end, previous[1]);
    else out.push([start, end]);
  }
  return out;
}
function subtractRanges(ranges, excluded) {
  let out = rangesUnion(ranges);
  for (const [left, right] of rangesUnion(excluded)) out = out.flatMap(([a, b]) => b <= left || a >= right ? [[a, b]] : [[a, Math.min(b, left)], [Math.max(a, right), b]].filter(([s, e]) => e > s));
  return out;
}
const duration = ranges => rangesUnion(ranges).reduce((n, [a, b]) => n + b - a, 0);

function normalizeUsage(data, now, fail) {
  if (!data || Object.keys(data).some(k => !["schemaVersion", "sessionId", "sequence", "platform", "build", "intervals"].includes(k)) || data.schemaVersion !== 1) fail("invalid-argument", "Unsupported usage schema.");
  if (typeof data.sessionId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.sessionId)
    || !Number.isSafeInteger(data.sequence) || data.sequence < 0 || !PLATFORMS.includes(data.platform)
    || typeof data.build !== "string" || !/^[A-Za-z0-9._+()-]{1,64}$/.test(data.build)
    || !Array.isArray(data.intervals) || !data.intervals.length || data.intervals.length > 60) fail("invalid-argument", "Invalid usage batch.");
  const intervals = data.intervals.map(row => {
    if (!row || Object.keys(row).some(k => !["startedAtMillis", "endedAtMillis", "feature"].includes(k))
      || !FEATURES.includes(row.feature) || !Number.isSafeInteger(row.startedAtMillis) || !Number.isSafeInteger(row.endedAtMillis)
      || row.startedAtMillis < now - 3 * DAY || row.endedAtMillis > now + 60000
      || row.endedAtMillis <= row.startedAtMillis || row.endedAtMillis - row.startedAtMillis > 60000) fail("invalid-argument", "Usage intervals must be recent and bounded.");
    return { startedAtMillis: row.startedAtMillis, endedAtMillis: row.endedAtMillis, feature: row.feature };
  });
  return { schemaVersion: 1, sessionId: data.sessionId.toLowerCase(), sequence: data.sequence, platform: data.platform, build: data.build, intervals };
}

// Exact ranges are short-lived detail, never the 24-month report summary.
function mergeDay(old, intervals, platform, now) {
  const channels = {};
  for (const p of PLATFORMS) for (const f of FEATURES) {
    const key = `${p}_${f}`;
    const existing = Array.isArray(old?.channels?.[key]) ? old.channels[key] : [];
    const incoming = p === platform ? intervals.filter(i => i.feature === f).map(i => [i.startedAtMillis, i.endedAtMillis]) : [];
    const union = rangesUnion([...existing, ...incoming]);
    // Firestore cannot store nested arrays. Use explicit endpoints on disk.
    channels[key] = union.map(([start, end]) => ({ start, end }));
  }
  return { schemaVersion: 1, channels, updatedAtMillis: now };
}
function decodeDay(day) {
  return { ...day, channels: Object.fromEntries(Object.entries(day?.channels || {}).map(([key, rows]) => [key, rows.map(row => Array.isArray(row) ? row : [row.start, row.end])])) };
}

function aggregateDay(detail, utcDate, now) {
  const dayStart = Date.parse(`${utcDate}T00:00:00Z`), grouped = new Map();
  const channels = decodeDay(detail).channels;
  for (const platform of PLATFORMS) for (const feature of FEATURES) {
    const key = `${platform}_${feature}`;
    for (const [a, b] of rangesUnion(channels[key] || [])) {
      for (let start = Math.max(a, dayStart); start < Math.min(b, dayStart + DAY);) {
        const index = Math.floor((start - dayStart) / BIN_MS), end = Math.min(b, dayStart + (index + 1) * BIN_MS);
        if (!grouped.has(index)) grouped.set(index, {});
        const bin = grouped.get(index); if (!bin[key]) bin[key] = [];
        bin[key].push([start, end]); start = end;
      }
    }
  }
  const bins = [...grouped].sort(([a], [b]) => a - b).map(([index, channels]) => {
    const web = FEATURES.flatMap(f => channels[`web_${f}`] || []), ios = FEATURES.flatMap(f => channels[`ios_${f}`] || []);
    const totalMillis = duration([...web, ...ios]), webMillis = duration(web), iosMillis = duration(ios);
    const featureMillis = {}; let allocated = [];
    for (const feature of FEATURES) {
      const own = subtractRanges([...(channels[`web_${feature}`] || []), ...(channels[`ios_${feature}`] || [])], allocated);
      featureMillis[feature] = duration(own); allocated = rangesUnion([...allocated, ...own]);
    }
    // Fixed quarter-hour index and totals only: no exact activity endpoints,
    // session identifiers, or event-level feature/platform records survive here.
    return { index, totalMillis, webMillis, iosMillis, overlapMillis: webMillis + iosMillis - totalMillis, featureMillis };
  });
  return { schemaVersion: 2, binMinutes: 15, bins, updatedAtMillis: now };
}
function validBin(bin) {
  return bin && Number.isInteger(bin.index) && bin.index >= 0 && bin.index < 96
    && [bin.totalMillis, bin.webMillis, bin.iosMillis, bin.overlapMillis].every(n => Number.isSafeInteger(n) && n >= 0 && n <= BIN_MS)
    && bin.totalMillis >= Math.max(bin.webMillis, bin.iosMillis)
    && bin.overlapMillis === bin.webMillis + bin.iosMillis - bin.totalMillis
    && FEATURES.every(f => Number.isSafeInteger(bin.featureMillis?.[f]) && bin.featureMillis[f] >= 0 && bin.featureMillis[f] <= bin.totalMillis)
    && FEATURES.reduce((sum, f) => sum + bin.featureMillis[f], 0) === bin.totalMillis;
}

function createInsightUsage({ db, HttpsError, Timestamp, now = Date.now }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  async function recordInsightUsage(data, auth) {
    if (!auth?.uid || !playerSegment(auth.uid) || auth.isAnonymous) fail("unauthenticated", "Sign in to continue.");
    if (isClubAdmin(auth)) fail("permission-denied", "Usage is recorded only for the signed-in athlete.");
    const current = now(), batch = normalizeUsage(data, current, fail), uid = auth.uid;
    return db.runTransaction(async tx => {
      const settingsRef = db.collection("insightSettings").doc("usage");
      const settings = await tx.get(settingsRef);
      if (settings.data()?.enabled !== true) return { accepted: false, reason: "disabled" };
      const matches = new Map();
      for (const field of ["authenticationUID", "userUID"]) {
        const result = await tx.get(db.collection("players").where(field, "==", uid).limit(2));
        for (const row of result.docs) matches.set(row.id, row);
      }
      const direct = await tx.get(db.collection("players").doc(uid));
      if (direct.exists) matches.set(direct.id, direct);
      const coach = await tx.get(db.collection("coaches").doc(uid));
      const coaches = await tx.get(db.collection("coaches").where("userUID", "==", uid).limit(1));
      if (coach.exists || !coaches.empty || matches.size !== 1) fail("permission-denied", "Usage is recorded only for a linked athlete account.");
      const player = [...matches.values()][0], profile = player.data();
      if (["authenticationUID", "userUID"].some(k => Object.hasOwn(profile, k) && profile[k] !== uid)) fail("permission-denied", "Athlete binding changed.");
      if (profile.organizationId) {
        if (!playerSegment(profile.organizationId)) fail("permission-denied", "Invalid organization binding.");
        const member = await tx.get(db.collection("organizations").doc(profile.organizationId).collection("members").doc(uid));
        if (member.exists) fail("permission-denied", "Staff activity is not athlete usage.");
      }
      const root = db.collection("insightUsageDays").doc(player.id);
      const receipt = db.collection("insightUsageIntervals").doc(hash([uid, batch.sessionId, batch.sequence]));
      const rateRef = db.collection("insightUsageActors").doc(uid);
      const [previous, overview, rate] = await Promise.all([tx.get(receipt), tx.get(root), tx.get(rateRef)]);
      const digest = hash(batch);
      if (previous.exists) {
        if (previous.data().digest !== digest || previous.data().playerId !== player.id) fail("already-exists", "Usage sequence already contains different evidence.");
        return { accepted: true, duplicate: true };
      }
      const window = Math.floor(current / 60000);
      const count = rate.data()?.window === window ? rate.data().count : 0;
      if (count >= 12) fail("resource-exhausted", "Usage upload rate exceeded; retry later.");
      const days = new Map();
      for (const interval of batch.intervals) {
        // Clamp clock skew to server receipt time; never credit future activity.
        const end = Math.min(interval.endedAtMillis, current);
        for (let start = interval.startedAtMillis; start < end;) {
          const next = Math.min(end, (Math.floor(start / DAY) + 1) * DAY), key = dayKey(start);
          if (!days.has(key)) days.set(key, []);
          days.get(key).push({ ...interval, startedAtMillis: start, endedAtMillis: next }); start = next;
        }
      }
      const snapshots = await Promise.all([...days.keys()].map(key => Promise.all([
        tx.get(root.collection("insightUsageDetailDays").doc(key)), tx.get(root.collection("insightUsageDaily").doc(key)),
      ])));
      let index = 0;
      for (const [key, rows] of days) {
        const [detail, summary] = snapshots[index++];
        // An old summary with exact channels can be converted on its next write.
        // Aggregate-only history cannot reconstruct a missing recent detail day.
        const previousDetail = detail.data() || (summary.data()?.schemaVersion === 1 ? summary.data() : undefined);
        if (!previousDetail && summary.exists) fail("failed-precondition", "Recent usage detail is missing; report repair is required.");
        const merged = mergeDay(decodeDay(previousDetail), rows, batch.platform, current);
        if (JSON.stringify(merged).length > 700000) fail("resource-exhausted", "Daily usage detail limit reached.");
        const expiry = new Date(key + "T00:00:00Z"); expiry.setUTCMonth(expiry.getUTCMonth() + 24);
        tx.set(detail.ref, { ...merged, expiresAt: Timestamp.fromMillis(Date.parse(key + "T00:00:00Z") + 90 * DAY) });
        tx.set(summary.ref, { ...aggregateDay(merged, key, current), expiresAt: Timestamp.fromMillis(expiry.getTime()) });
      }
      const first = Math.min(...batch.intervals.map(r => Math.min(r.startedAtMillis, current)));
      tx.set(root, { schemaVersion: 1, collectionStartedAtMillis: Math.min(overview.data()?.collectionStartedAtMillis ?? first, first), updatedAtMillis: current,
        platforms: [...new Set([...(overview.data()?.platforms || []), batch.platform])].sort(),
        builds: { ...(overview.data()?.builds || {}), [batch.platform]: batch.build },
        platformStartedAtMillis: { ...(overview.data()?.platformStartedAtMillis || {}), [batch.platform]: Math.min(overview.data()?.platformStartedAtMillis?.[batch.platform] ?? first, first) } });
      tx.set(receipt, { ...batch, actorUid: uid, playerId: player.id, digest, receivedAtMillis: current, expiresAt: Timestamp.fromMillis(current + 90 * DAY) });
      tx.set(rateRef, { window, count: count + 1, expiresAt: Timestamp.fromMillis(current + DAY) });
      return { accepted: true, duplicate: false };
    });
  }
  return { recordInsightUsage };
}

async function readPlayerUsage(db, playerId, startMillis, endMillis, timeZone = "America/Los_Angeles") {
  if (!playerSegment(playerId) || !Number.isFinite(startMillis) || !Number.isFinite(endMillis) || endMillis <= startMillis) throw new Error("Invalid usage report range");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const localDate = ms => {
    const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`;
  };
  const root = db.collection("insightUsageDays").doc(playerId), overview = await root.get();
  const base = { collected: overview.exists && overview.data()?.collectionStartedAtMillis < endMillis, collectionStartedAtMillis: overview.data()?.collectionStartedAtMillis ?? null,
    webCollected: overview.data()?.platforms?.includes('web') === true && overview.data()?.platformStartedAtMillis?.web < endMillis,
    iosCollected: overview.data()?.platforms?.includes('ios') === true && overview.data()?.platformStartedAtMillis?.ios < endMillis,
    webCollectionStartedAtMillis: overview.data()?.platformStartedAtMillis?.web ?? null, iosCollectionStartedAtMillis: overview.data()?.platformStartedAtMillis?.ios ?? null,
    totalMillis: 0, webMillis: 0, iosMillis: 0, overlapMillis: 0, featureMillis: Object.fromEntries(FEATURES.map(f => [f, 0])),
    activeDays: 0, returning: false, latestAtMillis: null, days: [], complete: true };
  if (!base.collected) return base;
  // One ascending indexed scan, with an explicit bound covering 24 months.
  const snapshot = await root.collection("insightUsageDaily").orderBy("__name__").startAfter(dayKey(startMillis - DAY)).limit(734).get();
  base.complete = snapshot.docs.length < 734;
  const days = new Map();
  for (const doc of snapshot.docs) {
    if (doc.id > dayKey(endMillis)) break;
    const day = doc.data();
    if (millis(day.expiresAt) <= Date.now()) continue;
    if (day.schemaVersion !== 2 || day.binMinutes !== 15 || !Array.isArray(day.bins) || day.bins.length > 96
      || !day.bins.every(validBin) || new Set(day.bins.map(b => b.index)).size !== day.bins.length
      || !/^\d{4}-\d{2}-\d{2}$/.test(doc.id) || !Number.isSafeInteger(day.updatedAtMillis)) { base.complete = false; continue; }
    const dayStart = Date.parse(`${doc.id}T00:00:00Z`);
    for (const bin of day.bins) {
      const start = dayStart + bin.index * BIN_MS, end = start + BIN_MS;
      if (end <= startMillis || start >= endMillis || !bin.totalMillis) continue;
      // Whole local dates align to quarter hours in current supported zones.
      // Never prorate a boundary bin: exact endpoints have intentionally expired.
      // For a report through "now", the terminal bin is complete only if all
      // of its server-clamped evidence was received before the report cutoff.
      if (start < startMillis || (end > endMillis && day.updatedAtMillis > endMillis)
        || localDate(start) !== localDate(end - 1)) { base.complete = false; continue; }
      const date = localDate(start);
      if (!days.has(date)) days.set(date, { date, activeMillis: 0, webMillis: 0, iosMillis: 0, overlapMillis: 0 });
      const target = days.get(date);
      target.activeMillis += bin.totalMillis; target.webMillis += bin.webMillis;
      target.iosMillis += bin.iosMillis; target.overlapMillis += bin.overlapMillis;
      base.totalMillis += bin.totalMillis; base.webMillis += bin.webMillis; base.iosMillis += bin.iosMillis; base.overlapMillis += bin.overlapMillis;
      for (const feature of FEATURES) base.featureMillis[feature] += bin.featureMillis[feature];
    }
  }
  base.days = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  base.activeDays = base.days.length; base.returning = base.activeDays >= 2;
  // Existing callers use this as a pagination freshness signal, not an activity
  // timestamp. The root records observation time; no exact endpoint is invented.
  base.latestAtMillis = base.days.length ? overview.data()?.updatedAtMillis ?? null : null;
  return base;
}

module.exports = { createInsightUsage, readPlayerUsage, rangesUnion, subtractRanges, normalizeUsage, mergeDay, decodeDay, aggregateDay, FEATURES, PLATFORMS };
