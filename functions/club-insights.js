"use strict";

// Staff-only weekly activity and progress for one club team. Only per-week
// aggregates leave the server; raw rep documents and storage paths never do.

const { playerSegment } = require("./athlete-storage-paths");
const { isClubAdmin, clubMember, memberCanAccessPlayer } = require("./club-access");

const MAX_ROSTER = 200;
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

function summarizePlayer(reps, weeks, nowMillis) {
  const firstWeek = weeks[0];
  const weeklyReps = weeks.map(() => 0);
  const drillCounts = {};
  const series = new Map();
  let lastActiveMillis = null;
  let undatedReps = 0;
  for (const data of reps) {
    const createdAt = data.createdAt?.toMillis?.();
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) { undatedReps += 1; continue; }
    const activeDay = startOfUtcDay(Math.min(createdAt, nowMillis));
    if (lastActiveMillis === null || activeDay > lastActiveMillis) lastActiveMillis = activeDay;
    const index = Math.floor((weekStart(createdAt) - firstWeek) / WEEK_MS);
    if (index < 0 || index >= weeks.length) continue;
    const drill = drillOf(data);
    weeklyReps[index] += 1;
    drillCounts[drill] = (drillCounts[drill] || 0) + 1;
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
  return { lastActiveMillis, undatedReps, weeklyReps, drillCounts, metrics };
}

function createClubInsights({ db, HttpsError, now = () => Date.now(), maxRoster = MAX_ROSTER }) {
  async function getClubInsights(data, caller) {
    const { uid, email, emailVerified } = caller || {};
    if (typeof uid !== "string" || !playerSegment(uid)) throw new HttpsError("unauthenticated", "Sign in to continue.");
    const organizationId = data?.organizationId;
    const teamId = data?.teamId;
    if (!playerSegment(organizationId) || !playerSegment(teamId)) throw new HttpsError("invalid-argument", "Choose a valid organization and team.");
    const weekCount = data?.weeks === undefined ? DEFAULT_WEEKS : data.weeks;
    if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > MAX_WEEKS) throw new HttpsError("invalid-argument", `Choose between 1 and ${MAX_WEEKS} weeks.`);

    const team = await db.collection("teams").doc(teamId).get();
    if (!team.exists || team.data()?.organizationId !== organizationId) throw new HttpsError("not-found", "That team could not be found.");
    if (!isClubAdmin({ uid, email, emailVerified })) {
      const member = await clubMember(db, organizationId, uid);
      if (!memberCanAccessPlayer(member, uid, { teamId })) throw new HttpsError("permission-denied", "You do not have access to that team.");
    }

    const nowMillis = now();
    const weeks = weekWindow(nowMillis, weekCount);
    const roster = await db.collection("players").where("organizationId", "==", organizationId).where("teamId", "==", teamId).limit(maxRoster + 1).get();
    const players = await Promise.all(roster.docs.slice(0, maxRoster).map(async (doc) => {
      const profile = doc.data() || {};
      if (profile.organizationId !== organizationId || profile.teamId !== teamId) return null;
      const reps = await db.collection("players").doc(doc.id).collection("reps").get();
      return {
        id: doc.id,
        firstName: String(profile.firstName || "").slice(0, 100),
        lastName: String(profile.lastName || "").slice(0, 100),
        ...summarizePlayer(reps.docs.map((rep) => rep.data() || {}), weeks, nowMillis),
      };
    }));
    return {
      organizationId,
      teamId,
      teamName: String(team.data()?.name || "Team").slice(0, 120),
      generatedAtMillis: nowMillis,
      rosterTruncated: roster.docs.length > maxRoster,
      weeks,
      players: players.filter(Boolean).sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
    };
  }

  return { getClubInsights };
}

module.exports = { createClubInsights, summarizePlayer, weekStart, weekWindow, PRIMARY_METRICS, MAX_WEEKS };
