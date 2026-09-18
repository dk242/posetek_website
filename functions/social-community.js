"use strict";

const { idFor, clean, ownerUid } = require("./social-projection");
const PAGE = 20;
const rows = s => s.docs.map(d => ({ ...d.data(), id: d.id }));

// These projections contain no raw profile, date of birth, measurement or media URL.
function createSocialCommunity({ db, now, fail, segment, context, activity, present, playerRef, prefsRef }) {
  const profiles = db.collection("socialCommunityProfiles");
  const inbox = uid => db.collection("socialInbox").doc(uid).collection("items");
  const gate = c => { if (c.config.communityEnabled !== true) fail("failed-precondition", "PoseTek community is not available yet."); };
  const athlete = c => { if (!c.player || ownerUid(c.player, c.player.id) !== c.uid) fail("permission-denied", "Finish claiming your player account first."); };
  async function enabledActor(c) { athlete(c); const profile = (await profiles.doc(c.player.id).get()).data(); if (profile?.suspended) fail("permission-denied", "Community interactions are temporarily unavailable for this account."); }
  async function rate(c, key, limit, windowMs = 60000) {
    const ref = db.collection("socialRateLimits").doc(c.uid);
    await db.runTransaction(async tx => {
      const old = (await tx.get(ref)).data()?.[key] || {};
      const current = now() - (old.start || 0) < windowMs ? old : { start: now(), count: 0 };
      if (current.count >= limit) fail("resource-exhausted", "Please wait a moment before trying again.");
      tx.set(ref, { [key]: { start: current.start, count: current.count + 1 } }, { merge: true });
    });
  }
  const relationship = (c, uid) => {
    const e = c.edges.find(edge => edge.participants.includes(uid));
    return e?.blockedBy?.includes(c.uid) ? "blocked" : e?.status === "pending" ? e.requester === c.uid ? "sent" : "received" : e?.status || "none";
  };
  async function profileFor(c, playerId, direct = false) {
    const p = await playerRef(segment(playerId)).get();
    if (!p.exists) return null;
    const uid = ownerUid(p.data(), p.id);
    if (!uid || c.blocked.has(uid) || (await prefsRef(uid).get()).data()?.accountDeleted) return null;
    const rawProfile = (await profiles.doc(p.id).get()).data() || {};
    const saved = rawProfile.consentOwnerUid === uid ? rawProfile : { suspended: rawProfile.suspended === true };
    const mine = uid === c.uid;
    if (!mine && (saved.suspended || c.config.communityEnabled !== true)) return null;
    if (!mine && saved.discoverable !== true) {
      let related = direct && c.friends.includes(uid);
      if (direct && !related) {
        const posts = await db.collection("socialActivities").where("playerId", "==", p.id).where("communityPublished", "==", true).limit(401).get();
        for (const post of posts.docs) {
          try { await activity(c, post.id); related = true; break; }
          catch (error) { if (error.code !== "permission-denied") throw error; }
        }
      }
      if (!related) return null;
    }
    const fallback = [clean(p.data().firstName, 40), clean(p.data().lastName, 1)].filter(Boolean).join(" ") || "Athlete";
    const club = saved.showClub && p.data().organizationId ? await db.collection("organizations").doc(p.data().organizationId).get() : null;
    return { playerId: p.id, displayName: saved.displayName || fallback, discoverable: saved.discoverable === true,
      clubName: clean(club?.data()?.name), relationship: relationship(c, uid), mine,
      suspended: mine ? saved.suspended === true : false, showClub: saved.showClub === true, communityPostsWithdrawnAt: mine ? saved.withdrawnAt || null : null };
  }
  async function getProfile(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion);
    const target = data.playerId || c.player?.id;
    if (!target) fail("failed-precondition", "Choose a player.");
    const profile = await profileFor(c, target, true);
    if (!profile) fail("permission-denied", "This community profile is unavailable.");
    return profile;
  }
  async function saveProfile(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, 2); gate(c); await enabledActor(c);
    const displayName = clean(data.displayName, 61);
    if (!displayName || displayName.length > 60 || /[\r\n\u0000-\u001f]/.test(displayName)
      || typeof data.discoverable !== "boolean" || typeof data.showClub !== "boolean") fail("invalid-argument", "Choose a display name and valid discovery settings.");
    await rate(c, "profile", 10);
    await profiles.doc(c.player.id).set({ consentOwnerUid: c.uid, displayName, searchName: displayName.toLocaleLowerCase("en-US"), discoverable: data.discoverable, showClub: data.showClub, updatedAt: now() }, { merge: true });
    return profileFor(c, c.player.id);
  }
  async function discover(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, 2); gate(c);
    const query = clean(data.query, 61).toLocaleLowerCase("en-US");
    if (query.length > 60) fail("invalid-argument", "Search is too long.");
    let q = profiles.where("discoverable", "==", true).orderBy("__name__");
    if (data.cursor) q = q.startAfter(segment(data.cursor));
    // Bounded scan makes filtering stable without introducing a global roster search.
    const page = await q.limit(100).get(), people = []; let last = null, scanned = 0;
    for (const doc of page.docs) {
      last = doc.id; scanned++;
      if (query && !(doc.data().searchName || "").includes(query)) continue;
      const p = await profileFor(c, doc.id);
      if (p && !p.mine) people.push(p);
      if (people.length === PAGE) break;
    }
    return { people, cursor: last && (scanned < page.size || page.size === 100) ? last : null };
  }
  async function withdraw(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, 2); athlete(c);
    await profiles.doc(c.player.id).set({ withdrawnAt: now() }, { merge: true });
    return { ok: true };
  }
  function notification(tx, recipientUid, type, actorPlayerId, sourceId, extra = {}) {
    const id = idFor(type, actorPlayerId || extra.actorUid, extra.activityId || null, sourceId);
    return { ref: inbox(recipientUid).doc(id), data: { id, type, actorPlayerId, sourceId, ...extra, createdAt: now(), read: false } };
  }
  async function getInbox(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, 2); athlete(c);
    let q = inbox(c.uid).orderBy("createdAt", "desc").orderBy("id", "desc");
    if (data.cursor) { segment(data.cursor.id); if (!Number.isFinite(data.cursor.time)) fail("invalid-argument", "Invalid inbox cursor."); q = q.startAfter(data.cursor.time, data.cursor.id); }
    const page = await q.limit(50).get(), items = [];
    for (const row of rows(page)) {
      const p = row.actorPlayerId ? await playerRef(segment(row.actorPlayerId)).get() : null;
      const uid = p?.exists ? ownerUid(p.data(), p.id) : row.actorUid;
      if (!uid || c.blocked.has(uid) || (await prefsRef(uid).get()).data()?.accountDeleted) continue;
      const profile = p?.exists ? (await profiles.doc(p.id).get()).data() || {} : {};
      if (profile.suspended) continue;
      if (["request", "accepted"].includes(row.type)) {
        const edge = c.edges.find(e => e.participants.includes(uid));
        if (!edge || edge.status !== (row.type === "request" ? "pending" : "accepted") || (row.type === "request" && edge.requester !== uid)) continue;
      } else {
        try {
          const { a } = await activity(c, row.activityId);
          if (row.type === "comment") {
            const comment = await db.collection("socialActivities").doc(a.id).collection("comments").doc(row.sourceId).get();
            if (!comment.exists || comment.data().uid !== uid) continue;
          }
          if (row.type === "kudos" && !(await db.collection("socialActivities").doc(a.id).collection("kudos").doc(uid).get()).exists) continue;
        } catch (error) { if (error.code === "permission-denied" || error.code === "not-found") continue; throw error; }
      }
      const displayName = p?.exists ? (profile.consentOwnerUid === uid && profile.displayName) || [clean(p.data().firstName, 40), clean(p.data().lastName, 1)].filter(Boolean).join(" ") || "Athlete" : "PoseTek staff";
      items.push({ id: row.id, type: row.type, actor: { playerId: p?.id || null, displayName }, ...(row.activityId ? { activityId: row.activityId } : {}), createdAt: row.createdAt, read: row.read === true });
    }
    // Count only currently visible unread entries, never blocked/private events.
    return { items, cursor: page.size === 50 ? { time: page.docs.at(-1).data().createdAt, id: page.docs.at(-1).id } : null,
      unreadCount: items.filter(item => !item.read).length, unreadCountIsLowerBound: page.size === 50 };
  }
  async function markRead(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, 2); athlete(c);
    if (!Array.isArray(data.ids) || !data.ids.length || data.ids.length > 50) fail("invalid-argument", "Choose up to 50 notifications.");
    await db.runTransaction(async tx => {
      const docs = await Promise.all([...new Set(data.ids)].map(id => tx.get(inbox(c.uid).doc(segment(id)))));
      for (const d of docs) if (d.exists) tx.update(d.ref, { read: true });
    }); return { ok: true };
  }
  async function reportContent(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, 2); await enabledActor(c);
    const reason = clean(data.reason, 501);
    if (!reason || reason.length > 500 || !["activity", "comment", "profile"].includes(data.targetType)) fail("invalid-argument", "Choose content and describe the issue.");
    const target = { targetType: data.targetType };
    if (data.targetType === "profile") { if (!await profileFor(c, data.playerId, true)) fail("permission-denied", "This profile is unavailable."); target.playerId = segment(data.playerId); }
    else {
      const { a } = await activity(c, data.activityId); target.activityId = a.id;
      if (data.targetType === "comment") {
        const doc = await db.collection("socialActivities").doc(a.id).collection("comments").doc(segment(data.commentId)).get();
        if (!doc.exists || c.blocked.has(doc.data().uid)) fail("permission-denied", "This comment is unavailable.");
        target.commentId = doc.id;
      }
    }
    await rate(c, "reports", 10);
    const id = idFor(c.uid, target);
    await db.collection("socialReports").doc(id).set({ ...target, reason, reporterUid: c.uid, createdAt: now(), resolved: false });
    return { ok: true };
  }
  async function moderate(data, auth) {
    const c = await context(auth, data.organizationId, undefined, 2);
    if (!c.admin) fail("permission-denied", "Administrator access required.");
    if (!data.action) {
      const [open, suspended] = await Promise.all([
        db.collection("socialReports").where("resolved", "==", false).limit(50).get(),
        db.collection("socialReports").where("resolution", "==", "suspendProfile").limit(50).get(),
      ]);
      const reports = new Map([...rows(open), ...rows(suspended)].map(row => [row.id, row]));
      const result = [];
      for (const { reporterUid, moderatorUid, ...r } of reports.values()) {
        const targetSuspended = r.playerId ? (await profiles.doc(r.playerId).get()).data()?.suspended === true : false;
        if (!r.resolved || targetSuspended) result.push({ ...r, targetSuspended });
      }
      return { reports: result };
    }
    if (!["hideActivity", "removeComment", "suspendProfile", "restoreProfile", "dismiss"].includes(data.action)) fail("invalid-argument", "Choose a moderation action.");
    const ref = db.collection("socialReports").doc(segment(data.reportId));
    await db.runTransaction(async tx => {
      const report = await tx.get(ref); if (!report.exists) fail("not-found", "Report not found.");
      const r = report.data(), kind = r.targetType || "activity";
      if (data.action === "hideActivity" && !r.activityId || data.action === "removeComment" && kind !== "comment" || ["suspendProfile", "restoreProfile"].includes(data.action) && kind !== "profile") fail("invalid-argument", "Action does not match this report.");
      if (data.action === "hideActivity") tx.set(db.collection("socialActivitySettings").doc(segment(r.activityId)), { moderated: true }, { merge: true });
      if (data.action === "removeComment") tx.delete(db.collection("socialActivities").doc(segment(r.activityId)).collection("comments").doc(segment(r.commentId)));
      if (["suspendProfile", "restoreProfile"].includes(data.action)) tx.set(profiles.doc(segment(r.playerId)), { suspended: data.action === "suspendProfile", suspendedAt: now() }, { merge: true });
      tx.set(ref, { resolved: true, resolution: data.action, resolvedAt: now(), moderatorUid: c.uid }, { merge: true });
      tx.set(db.collection("socialModerationAudit").doc(idFor(ref.id, data.action)), { reportId: ref.id, action: data.action, moderatorUid: c.uid, at: now() });
    }); return { ok: true };
  }
  return { gate, athlete, enabledActor, rate, profileFor, notification, getProfile, saveProfile, discover, withdraw, getInbox, markRead, reportContent, moderate };
}
module.exports = { createSocialCommunity };
