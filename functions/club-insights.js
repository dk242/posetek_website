"use strict";

// Staff-only weekly activity and progress for one club team. Only per-week
// aggregates leave the server; raw rep documents and storage paths never do.

const { playerSegment } = require("./athlete-storage-paths");
const { isClubAdmin, memberCanAccessPlayer } = require("./club-access");

const MAX_ROSTER = 200;
const MAX_REP_DOCUMENTS = 1000;
const MAX_TOTAL_REP_DOCUMENTS = 20000;
const READ_CONCURRENCY = 8;
const DEFAULT_WEEKS = 8;
const MAX_WEEKS = 26;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const DRILL_ALIASES = { side_kick: "shooting", deadballShot: "shooting", shooting: "shooting" };
const PRIMARY_METRICS = {
  sprint: { fields: ["max_velocity", "maxVelocity"], lowerIsBetter: false },
  jump: { fields: ["jump_height_m", "jumpHeight", "jump_height_in", "jump_height_inches"], lowerIsBetter: false },
  broadJump: { fields: ["broadJumpDistance"], lowerIsBetter: false },
  shooting: { fields: ["velocity"], lowerIsBetter: false },
  changeOfDirection: { fields: ["totalTime"], lowerIsBetter: true },
  dribbling: { fields: ["totalTime"], lowerIsBetter: true },
};

function drillOf(data) {
  const raw = typeof data.repType === "string" && data.repType ? data.repType : typeof data.drillType === "string" ? data.drillType : "";
  const drill = Object.hasOwn(DRILL_ALIASES, raw) ? DRILL_ALIASES[raw] : raw;
  return /^[A-Za-z0-9_]{1,40}$/.test(drill) && !(drill in Object.prototype) ? drill : "unknown";
}

function weekStart(millis) {
  const date = new Date(millis);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
}

function weekWindow(nowMillis, count) {
  const current = weekStart(nowMillis);
  return Array.from({ length: count }, (_, index) => current - (count - 1 - index) * WEEK_MS);
}

function startOfUtcDay(millis) {
  const date = new Date(millis);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function recordedMillis(data) {
  // Keep the prototype's recorded-at contract. Malformed timestamps must not
  // crash an otherwise useful team report or become epoch/future activity.
  try {
    const value = typeof data.createdAt?.toMillis === "function" ? data.createdAt.toMillis() : null;
    return typeof value === "number" && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
  } catch { return null; }
}

function usableMetrics(data) {
  if (Object.hasOwn(data, "resultsValid") && data.resultsValid !== true) return false;
  if (Object.hasOwn(data, "processingStatus") && data.processingStatus !== "complete") return false;
  // Older records omit processing flags. Their positive numeric root fields
  // remain usable, including values replaced by an accepted admin revision.
  return !Array.isArray(data.failedSteps) || data.failedSteps.length === 0;
}

async function mapBounded(items, concurrency, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}

function summarizePlayer(reps, weeks, nowMillis) {
  const firstWeek = weeks[0];
  const weeklyReps = weeks.map(() => 0);
  const drillCounts = {};
  const series = new Map();
  let lastActiveMillis = null;
  let undatedReps = 0;
  let futureDatedReps = 0;
  for (const data of reps) {
    const createdAt = recordedMillis(data);
    if (createdAt === null) { undatedReps += 1; continue; }
    if (createdAt > nowMillis) { futureDatedReps += 1; continue; }
    const activeDay = startOfUtcDay(createdAt);
    if (lastActiveMillis === null || activeDay > lastActiveMillis) lastActiveMillis = activeDay;
    const index = Math.floor((weekStart(createdAt) - firstWeek) / WEEK_MS);
    if (index < 0 || index >= weeks.length) continue;
    const drill = drillOf(data);
    weeklyReps[index] += 1;
    drillCounts[drill] = (drillCounts[drill] || 0) + 1;
    // Activity counts documents, including failed processing. Only usable
    // completed/legacy results can contribute to progress metrics.
    if (!usableMetrics(data)) continue;
    const spec = Object.hasOwn(PRIMARY_METRICS, drill) ? PRIMARY_METRICS[drill] : null;
    const field = spec?.fields.find((name) => typeof data[name] === "number" && Number.isFinite(data[name]) && data[name] > 0);
    if (!field) continue;
    const key = `${drill}:${field}`;
    if (!series.has(key)) series.set(key, { drill, field, lowerIsBetter: spec.lowerIsBetter, weeklyBest: weeks.map(() => null) });
    const entry = series.get(key);
    const current = entry.weeklyBest[index];
    const value = data[field];
    if (current === null || (spec.lowerIsBetter ? value < current : value > current)) entry.weeklyBest[index] = value;
  }
  const metrics = [...series.values()].sort((a, b) => a.drill.localeCompare(b.drill) || a.field.localeCompare(b.field));
  return { lastActiveMillis, undatedReps, futureDatedReps, weeklyReps, drillCounts, metrics };
}

function createClubInsights({ db, HttpsError, now = () => Date.now(), maxRoster = MAX_ROSTER,
  maxRepDocuments = MAX_REP_DOCUMENTS, maxTotalRepDocuments = MAX_TOTAL_REP_DOCUMENTS, readConcurrency = READ_CONCURRENCY }) {
  for (const [value, max] of [[maxRoster, MAX_ROSTER], [maxRepDocuments, MAX_REP_DOCUMENTS], [maxTotalRepDocuments, MAX_TOTAL_REP_DOCUMENTS], [readConcurrency, READ_CONCURRENCY]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error("Invalid Insights read limit");
  }
  if (maxTotalRepDocuments < maxRoster) throw new Error("Insights total read limit must cover its roster limit");
  async function getClubInsights(data, caller) {
    const { uid } = caller || {};
    if (typeof uid !== "string" || !playerSegment(uid) || caller.isAnonymous === true) throw new HttpsError("unauthenticated", "Sign in to continue.");
    const organizationId = data?.organizationId;
    const teamId = data?.teamId;
    if (!playerSegment(organizationId) || !playerSegment(teamId)) throw new HttpsError("invalid-argument", "Choose a valid organization and team.");
    const weekCount = data?.weeks === undefined ? DEFAULT_WEEKS : data.weeks;
    if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > MAX_WEEKS) throw new HttpsError("invalid-argument", `Choose between 1 and ${MAX_WEEKS} weeks.`);

    const teamRef = db.collection("teams").doc(teamId);
    const organizationRef = db.collection("organizations").doc(organizationId);
    const memberRef = organizationRef.collection("members").doc(uid);
    const admin = isClubAdmin(caller);
    async function authorize(transaction) {
      const read = ref => transaction ? transaction.get(ref) : ref.get();
      const [team, organization, membership] = await Promise.all([read(teamRef), read(organizationRef), admin ? null : read(memberRef)]);
      if (!organization.exists || !team.exists || team.data()?.organizationId !== organizationId) throw new HttpsError("not-found", "That organization or team could not be found.");
      if (!admin) {
        const member = membership.exists ? membership.data() : null;
        if (!memberCanAccessPlayer(member, uid, { teamId }) || !member.teamIds.every(id => typeof id === "string" && playerSegment(id))) {
          throw new HttpsError("permission-denied", "You do not have access to that team.");
        }
      }
      return team.data();
    }
    await authorize();

    const nowMillis = now();
    const weeks = weekWindow(nowMillis, weekCount);
    const roster = await db.collection("players").where("organizationId", "==", organizationId).where("teamId", "==", teamId).orderBy("__name__").limit(maxRoster + 1).get();
    const selected = roster.docs.slice(0, maxRoster);
    const repLimitPerPlayer = Math.min(maxRepDocuments, Math.floor(maxTotalRepDocuments / Math.max(1, selected.length)));
    const aggregates = await mapBounded(selected, readConcurrency, async (doc) => {
      const profile = doc.data() || {};
      if (profile.organizationId !== organizationId || profile.teamId !== teamId) return null;
      // Stable document ordering retains undated records, which a createdAt
      // query would hide. The response explicitly flags incomplete history.
      const reps = await db.collection("players").doc(doc.id).collection("reps").orderBy("__name__").limit(repLimitPerPlayer + 1).get();
      const inspected = reps.docs.slice(0, repLimitPerPlayer);
      return {
        id: doc.id,
        repsTruncated: reps.docs.length > repLimitPerPlayer,
        recordedDocumentsRead: inspected.length,
        ...summarizePlayer(inspected.map((rep) => rep.data() || {}), weeks, nowMillis),
      };
    });
    // Recheck membership, team ownership and every returned player's canonical
    // ownership together after the history reads. No writes or legacy mirrors.
    const { team, players } = await db.runTransaction(async transaction => {
      const team = await authorize(transaction);
      const fresh = await mapBounded(aggregates.filter(Boolean), readConcurrency, async player => {
        const snapshot = await transaction.get(db.collection("players").doc(player.id));
        const profile = snapshot.exists ? snapshot.data() : null;
        if (!profile || profile.organizationId !== organizationId || profile.teamId !== teamId) return null;
        return { ...player, firstName: String(profile.firstName || "").slice(0, 100), lastName: String(profile.lastName || "").slice(0, 100) };
      });
      return { team, players: fresh.filter(Boolean).sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)) };
    }, { readOnly: true });
    return {
      organizationId,
      teamId,
      teamName: String(team.name || "Team").slice(0, 120),
      generatedAtMillis: nowMillis,
      rosterTruncated: roster.docs.length > maxRoster,
      historyTruncated: players.some(player => player.repsTruncated),
      repLimitPerPlayer,
      recordedDocumentsRead: players.reduce((total, player) => total + player.recordedDocumentsRead, 0),
      weeks,
      players,
    };
  }

  return { getClubInsights };
}

module.exports = { createClubInsights, summarizePlayer, weekStart, weekWindow, PRIMARY_METRICS, MAX_WEEKS };
