"use strict";

// Athlete team leaderboards. Firestore rules deny an athlete reading
// teammates' profiles and rep documents, so the projection is built here from
// the roster the caller belongs to and whitelisted to names plus the metric
// fields the boards rank on. Nothing else about a teammate leaves the server.

const { playerSegment } = require("./athlete-storage-paths");
const { isClubAdmin, clubMember, memberCanAccessPlayer } = require("./club-access");
const { mapBounded } = require("./insights-v2-projection");

const CANONICAL_UID_FIELDS = ["authenticationUID", "userUID"];
const MAX_ROSTER = 200;
const NUMERIC_FIELDS = [
  "sessionNumber", "repNumber", "absoluteRepNumber",
  "jumpHeight", "jump_height_in", "jump_height_inches", "jump_height_m", "broadJumpDistance",
  "max_velocity", "maxVelocity", "velocity",
  "totalTime", "totalDistance", "markerDistance", "phase1Time", "phase2Time", "phase3Time", "avgBallDistance",
  "max_acceleration", "maxAcceleration", "average_velocity", "averageVelocity",
  "time_to_max_velocity", "timeToMaxVelocity", "launch_angle", "launchAngle",
];
const STRING_FIELDS = ["repType", "drillType", "strike_foot", "dribble_foot"];

function projectedRep(doc) {
  const data = doc.data() || {};
  const rep = { id: doc.id };
  for (const field of STRING_FIELDS) if (typeof data[field] === "string") rep[field] = data[field].slice(0, 40);
  for (const field of NUMERIC_FIELDS) if (typeof data[field] === "number" && Number.isFinite(data[field])) rep[field] = data[field];
  const createdAt = data.createdAt?.toMillis?.() ?? data.createdAtMillis;
  if (typeof createdAt === "number") rep.createdAtMillis = createdAt;
  if (data.resultStatus) rep.resultStatus = { qualified: data.resultStatus.qualified === true,
    duplicate: data.resultStatus.duplicate === true, reason: data.resultStatus.reason,
    revisionId: data.resultStatus.revisionId ?? null };
  return rep;
}

function createTeamLeaderboard({ db, HttpsError, effectiveResults }) {
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
  async function getTeamLeaderboard({ uid, email, emailVerified, teamId }) {
    if (typeof uid !== "string" || !playerSegment(uid)) throw new HttpsError("unauthenticated", "Sign in to continue.");
    if (teamId !== undefined && !playerSegment(teamId)) throw new HttpsError("invalid-argument", "Choose a valid team.");
    const player = await ownedPlayer(uid);
    const bound = player?.data() || {};
    const selectedTeam = teamId || (Object.hasOwn(bound, "organizationId") ? bound.teamId : null);
    let ids;
    let clubOrganizationId = null;
    let coachId = null;
    if (selectedTeam) {
      if (!playerSegment(selectedTeam)) throw new HttpsError("failed-precondition", "Ask your club manager to repair your team assignment.");
      const team = await db.collection("teams").doc(selectedTeam).get();
      if (!team.exists || !playerSegment(team.data().organizationId)) throw new HttpsError("not-found", "That team could not be found.");
      clubOrganizationId = team.data().organizationId;
      const ownTeam = player && bound.organizationId === clubOrganizationId && bound.teamId === selectedTeam;
      const staff = await clubMember(db, clubOrganizationId, uid);
      if (!ownTeam && !isClubAdmin({ uid, email, emailVerified }) && !memberCanAccessPlayer(staff, uid, { teamId: selectedTeam })) throw new HttpsError("permission-denied", "You do not have access to that team.");
      // Query canonical player assignments, never stale coach/team roster arrays.
      const roster = await db.collection("players").where("organizationId", "==", clubOrganizationId).where("teamId", "==", selectedTeam).limit(MAX_ROSTER).get();
      ids = roster.docs.map((doc) => doc.id);
    } else {
      if (!player) throw new HttpsError("permission-denied", "Your login is not linked to an athlete profile yet.");
      if (Object.hasOwn(bound, "organizationId")) throw new HttpsError("failed-precondition", "Ask your club manager to assign you to a team.");
      const coach = await rosterFor(player);
      if (!coach) throw new HttpsError("failed-precondition", "You haven't been added to a team yet. Ask your coach to add you.");
      coachId = coach.id;
      const members = Array.isArray(coach.data()?.members) ? coach.data().members : [];
      ids = [...new Set([...members, player.id])].filter(playerSegment).slice(0, MAX_ROSTER);
    }
    if (!effectiveResults?.listForPlayer) throw new HttpsError("unavailable", "Verified standings are temporarily unavailable.");
    const athletes = await mapBounded(ids, 4, async (id) => {
      const profile = await db.collection("players").doc(id).get();
      if (!profile.exists) return null;
      const data = profile.data() || {};
      // Recheck assignment before accessing reps; cross-team or newly migrated
      // records in legacy projections cannot leak into a stale roster.
      if (clubOrganizationId ? data.organizationId !== clubOrganizationId || data.teamId !== selectedTeam : Object.hasOwn(data, "organizationId")) return null;
      const result = await effectiveResults.listForPlayer(id);
      const current = (await db.collection("players").doc(id).get()).data();
      if (!current || (clubOrganizationId ? current.organizationId !== clubOrganizationId || current.teamId !== selectedTeam : Object.hasOwn(current, "organizationId"))) return null;
      const reps = result.reps.filter(rep => rep.resultStatus?.qualified === true && rep.resultStatus?.duplicate === false)
        .map(rep => projectedRep({ id: rep.id, data: () => ({ ...rep, repType: rep.repType === "shooting" ? "side_kick" : rep.repType }) }));
      return { id, firstName: String(data.firstName || "").slice(0, 100), lastName: String(data.lastName || "").slice(0, 100), reps };
    });
    // Evidence may take time to load. Recheck current roster authority before
    // returning any teammate data; revoked membership never gets cached access.
    const currentPlayer = await ownedPlayer(uid), currentBound = currentPlayer?.data() || {};
    if (selectedTeam) {
      const team = await db.collection("teams").doc(selectedTeam).get();
      const ownTeam = currentPlayer && currentBound.organizationId === clubOrganizationId && currentBound.teamId === selectedTeam;
      const staff = await clubMember(db, clubOrganizationId, uid);
      if (!team.exists || team.data().organizationId !== clubOrganizationId
        || (!ownTeam && !isClubAdmin({ uid, email, emailVerified }) && !memberCanAccessPlayer(staff, uid, { teamId: selectedTeam }))) throw new HttpsError("permission-denied", "You do not have access to that team.");
    } else {
      const currentCoach = currentPlayer && !Object.hasOwn(currentBound, "organizationId") ? await rosterFor(currentPlayer) : null;
      const members = currentCoach?.data()?.members;
      if (!currentPlayer || currentPlayer.id !== player.id || currentCoach?.id !== coachId
        || !Array.isArray(members) || ids.some(id => id !== currentPlayer.id && !members.includes(id))) throw new HttpsError("permission-denied", "Your team assignment changed. Reload the standings.");
    }
    return { playerId: player?.id || null, coachId, ...(selectedTeam ? { teamId: selectedTeam, organizationId: clubOrganizationId } : {}), athletes: athletes.filter(Boolean) };
  }

  return { getTeamLeaderboard };
}

module.exports = { createTeamLeaderboard, projectedRep, NUMERIC_FIELDS, STRING_FIELDS };
