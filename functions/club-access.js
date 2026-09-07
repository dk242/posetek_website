"use strict";

const { playerSegment } = require("./athlete-storage-paths");

function isClubAdmin(auth) {
  return Boolean(auth?.uid && auth.emailVerified === true && typeof auth.email === "string"
    && /^[a-z0-9._%+-]+@posetek\.net$/i.test(auth.email) && auth.isAnonymous !== true);
}
function activeMember(member, uid) {
  return Boolean(member && member.userUID === uid && member.status === "active"
    && ["manager", "coach"].includes(member.role) && Array.isArray(member.teamIds));
}
function memberCanAccessPlayer(member, uid, player) {
  return activeMember(member, uid) && (member.role === "manager"
    || (playerSegment(player.teamId) && member.teamIds.includes(player.teamId)));
}
async function clubMember(db, organizationId, uid) {
  if (!playerSegment(organizationId) || !playerSegment(uid)) return null;
  const doc = await db.collection("organizations").doc(organizationId).collection("members").doc(uid).get();
  return doc.exists ? doc.data() : null;
}
async function clubStaffCanAccessPlayer(db, uid, player) {
  if (!playerSegment(player?.organizationId)) return false;
  return memberCanAccessPlayer(await clubMember(db, player.organizationId, uid), uid, player);
}
module.exports = { isClubAdmin, activeMember, memberCanAccessPlayer, clubMember, clubStaffCanAccessPlayer };
