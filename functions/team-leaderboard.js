"use strict";

// Athlete team leaderboards. Firestore rules deny an athlete reading
// teammates' profiles and rep documents, so the projection is built here from
// the roster the caller belongs to and whitelisted to names plus the metric
// fields the boards rank on. Nothing else about a teammate leaves the server.

const { playerSegment } = require("./athlete-storage-paths");

const CANONICAL_UID_FIELDS = ["authenticationUID", "userUID"];
const MAX_ROSTER = 200;
const NUMERIC_FIELDS = [
  "sessionNumber", "repNumber", "absoluteRepNumber",
  "jumpHeight", "jump_height_in", "jump_height_inches", "jump_height_m", "broadJumpDistance",
  "max_velocity", "maxVelocity", "velocity",
  "totalTime", "totalDistance", "phase1Time", "phase2Time", "phase3Time", "avgBallDistance",
  "max_acceleration", "maxAcceleration", "average_velocity", "averageVelocity",
  "time_to_max_velocity", "timeToMaxVelocity", "launch_angle", "launchAngle",
];
const STRING_FIELDS = ["repType", "drillType", "strike_foot"];

function projectedRep(doc) {
  const data = doc.data() || {};
  const rep = { id: doc.id };
  for (const field of STRING_FIELDS) if (typeof data[field] === "string") rep[field] = data[field].slice(0, 40);
  for (const field of NUMERIC_FIELDS) if (typeof data[field] === "number" && Number.isFinite(data[field])) rep[field] = data[field];
  const createdAt = data.createdAt?.toMillis?.();
  if (typeof createdAt === "number") rep.createdAtMillis = createdAt;
  return rep;
}

function createTeamLeaderboard({ db, HttpsError }) {
  async function firstMatch(collection, field, value, operator = "==") {
    const result = await db.collection(collection).where(field, operator, value).limit(1).get();
    return result.empty ? null : result.docs[0];
  }

  async function ownedPlayer(uid) {
    const bound = await firstMatch("players", "authenticationUID", uid) || await firstMatch("players", "userUID", uid);
    const candidate = bound || (await db.collection("players").doc(uid).get());
    if (!candidate.exists) return null;
    const data = candidate.data() || {};
    if (CANONICAL_UID_FIELDS.some((field) => Object.hasOwn(data, field) && data[field] !== uid)) return null;
    return candidate;
  }

  async function rosterFor(player) {
    const data = player.data() || {};
    if (typeof data.coachDocId === "string" && data.coachDocId) {
      const coach = await db.collection("coaches").doc(data.coachDocId).get();
      if (coach.exists) return coach;
    }
    if (typeof data.coachUID === "string" && data.coachUID) {
      const direct = await db.collection("coaches").doc(data.coachUID).get();
      if (direct.exists) return direct;
      const byUid = await firstMatch("coaches", "userUID", data.coachUID);
      if (byUid) return byUid;
    }
    return firstMatch("coaches", "members", player.id, "array-contains");
  }

  /** Whitelisted standings input for the roster the caller is on. */
  async function getTeamLeaderboard({ uid }) {
    if (typeof uid !== "string" || !playerSegment(uid)) throw new HttpsError("unauthenticated", "Sign in to continue.");
    const player = await ownedPlayer(uid);
    if (!player) throw new HttpsError("permission-denied", "Your login is not linked to an athlete profile yet.");
    const coach = await rosterFor(player);
    if (!coach) throw new HttpsError("failed-precondition", "You haven't been added to a team yet. Ask your coach to add you.");
    const members = Array.isArray(coach.data()?.members) ? coach.data().members : [];
    const ids = [...new Set([...members, player.id])].filter(playerSegment).slice(0, MAX_ROSTER);
    const athletes = await Promise.all(ids.map(async (id) => {
      const [profile, reps] = await Promise.all([
        db.collection("players").doc(id).get(),
        db.collection("players").doc(id).collection("reps").get(),
      ]);
      if (!profile.exists) return null;
      const data = profile.data() || {};
      return {
        id,
        firstName: String(data.firstName || "").slice(0, 100),
        lastName: String(data.lastName || "").slice(0, 100),
        reps: reps.docs.map(projectedRep),
      };
    }));
    return { playerId: player.id, coachId: coach.id, athletes: athletes.filter(Boolean) };
  }

  return { getTeamLeaderboard };
}

module.exports = { createTeamLeaderboard, projectedRep, NUMERIC_FIELDS, STRING_FIELDS };
