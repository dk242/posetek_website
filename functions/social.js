"use strict";

const { playerSegment, storageFolderCandidates } = require("./athlete-storage-paths");
const { isClubAdmin, activeMember } = require("./club-access");
const { idFor, clean, nameOf, ownerUid, sessionKey, projectActivities, sameSummary } = require("./social-projection");

const bundledBenchmarks = require("./social-benchmarks.json");
const AUDIENCES = ["organization", "team", "friends", "private"];
const defaults = { audience: "organization", automatic: true, videos: true };
const rows = s => s.docs.map(d => ({ ...d.data(), id: d.id }));

function createSocial({ db, bucket, HttpsError, now = Date.now }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const segment = value => { if (!playerSegment(value)) fail("invalid-argument", "Invalid identifier."); return value; };
  const pairRef = (a, b) => db.collection("socialConnections").doc(idFor(...[a, b].sort()));
  const playerRef = id => db.collection("players").doc(id);
  const prefsRef = uid => db.collection("socialPreferences").doc(uid);
  async function resolvePlayer(uid) {
    const found = new Map();
    for (const field of ["authenticationUID", "userUID"]) {
      const s = await db.collection("players").where(field, "==", uid).limit(2).get();
      s.docs.forEach(d => found.set(d.id, d));
    }
    if (!found.size) { const direct = await playerRef(uid).get(); if (direct.exists) found.set(direct.id, direct); }
    if (found.size > 1) fail("failed-precondition", "Your athlete account needs its profile link repaired.");
    const p = [...found.values()][0];
    if (!p) return null;
    const data = p.data();
    if (["authenticationUID", "userUID"].some(k => Object.hasOwn(data, k) && data[k] !== uid)) fail("permission-denied", "Invalid athlete binding.");
    return { ...data, id: p.id };
  }
  async function context(auth, organizationId, viewAsPlayerId) {
    if (viewAsPlayerId) {
      if (!isClubAdmin(auth)) fail("permission-denied", "Only administrators can preview an athlete feed.");
      const target = await playerRef(segment(viewAsPlayerId)).get();
      const uid = target.exists && ownerUid(target.data(), target.id);
      if (!uid) fail("failed-precondition", "This athlete must finish signup before their account can be previewed.");
      if (organizationId && target.data().organizationId !== organizationId) fail("permission-denied", "This athlete belongs to another organization.");
      const c = await context({ uid }, undefined);
      if (c.player?.id !== target.id) fail("failed-precondition", "This athlete's account binding needs repair.");
      return { ...c, previewPlayerId: target.id, adminViewer: true };
    }
    if (!auth?.uid || auth.isAnonymous) fail("unauthenticated", "Sign in to see your community.");
    const uid = segment(auth.uid), player = await resolvePlayer(uid);
    const config = (await db.collection("socialSettings").doc("feed").get()).data() || {};
    const coach = (await db.collection("coaches").doc(uid).get()).data();
    let orgId = player?.organizationId || (coach?.userUID === uid ? coach.organizationId : null);
    if (isClubAdmin(auth)) orgId = organizationId ? segment(organizationId) : orgId || config.organizationIds?.[0] || null;
    let member = null;
    if (orgId) {
      segment(orgId);
      member = (await db.collection("organizations").doc(orgId).collection("members").doc(uid).get()).data();
    }
    const staff = activeMember(member, uid), admin = isClubAdmin(auth);
    if (!player && !staff && !admin) fail("permission-denied", "This account is not linked to an athlete or active club staff profile.");
    const enabled = config.enabled === true;
    if (!enabled && !admin) fail("failed-precondition", "The community feed is not available for your organization yet.");
    const [connections, preferences] = await Promise.all([
      db.collection("socialConnections").where("participants", "array-contains", uid).limit(1001).get(), prefsRef(uid).get(),
    ]);
    if (connections.size > 1000) fail("resource-exhausted", "Too many connections. Contact PoseTek support.");
    if (preferences.data()?.accountDeleted === true) fail("permission-denied", "This account is no longer active.");
    const edges = rows(connections), blocked = new Set(edges.filter(e => e.blockedBy?.length).flatMap(e => e.participants.filter(v => v !== uid)));
    const friends = edges.filter(e => e.status === "accepted" && !e.blockedBy?.length).map(e => e.participants.find(v => v !== uid));
    return { uid, player, orgId, staff, admin, member, config, enabled, edges, blocked, friends, preferences: { ...defaults, ...preferences.data() },
      displayName: player ? nameOf(player) : nameOf(member || { firstName: "PoseTek", lastName: "Staff" }) };
  }
  async function currentAuthor(activity) {
    const p = await playerRef(activity.playerId).get();
    if (!p.exists) return null;
    const data = p.data(), uid = ownerUid(data, p.id);
    const preferences = uid ? (await prefsRef(uid).get()).data() : {};
    if (preferences?.accountDeleted === true) return null;
    const override = (await db.collection("socialActivitySettings").doc(activity.id).get()).data() || {};
    return { p: data, uid, preferences: { ...defaults, ...preferences }, override };
  }
  async function allowed(c, a) {
    const author = await currentAuthor(a);
    if (!author) return null;
    if (author.uid && c.blocked.has(author.uid)) return null;
    if (author.override.moderated === true) return c.admin ? author : null;
    if (author.uid === c.uid || c.admin) return author;
    if (a.availableAt > now()) return null;
    const pref = author.preferences, audience = author.override.audience || pref.audience;
    if (author.override.hidden === true || audience === "private" || (pref.automatic === false && !author.override.audience)) return null;
    if (a.organizationId !== (author.p.organizationId || "") || a.teamId !== (author.p.teamId || "")) return null;
    if (["organization", "friends"].includes(audience) && author.uid && c.friends.includes(author.uid)) return author;
    if (audience === "organization" && c.orgId && c.orgId === author.p.organizationId) return author;
    if (audience === "team" && c.orgId === author.p.organizationId && (c.player?.teamId === author.p.teamId || (c.staff && (c.member.role === "manager" || c.member.teamIds.includes(author.p.teamId))))) return author;
    return null;
  }
  async function activity(c, id) {
    const doc = await db.collection("socialActivities").doc(segment(id)).get();
    const a = doc.exists ? { ...doc.data(), id: doc.id } : null;
    const author = a && await allowed(c, a);
    if (!author) fail("permission-denied", "This activity is no longer available to you.");
    return { a, author };
  }
  async function present(c, a, author) {
    const [kudos, count, comments, team] = await Promise.all([
      db.collection("socialActivities").doc(a.id).collection("kudos").doc(c.uid).get(),
      db.collection("socialActivities").doc(a.id).collection("kudos").count().get(),
      db.collection("socialActivities").doc(a.id).collection("comments").count().get(),
      author.p.teamId ? db.collection("teams").doc(author.p.teamId).get() : null,
    ]);
    return { id: a.id, playerId: a.playerId, authorName: nameOf(author.p), authorUid: author.uid, teamName: clean(team?.data()?.name),
      title: a.title, subtitle: a.subtitle, kind: a.kind, occurredAt: a.occurredAt, metrics: a.metrics, chart: a.chart, score: a.score,
      partial: a.partial, drill: a.drill, repCount: a.repIds.length, canViewVideo: author.preferences.videos !== false && a.repIds.length > 0,
      mine: author.uid === c.uid, audience: author.override.audience || author.preferences.audience, hidden: author.override.hidden === true,
      kudos: count.data().count, liked: kudos.exists, comments: comments.data().count };
  }
  async function adminDirectory(data, auth) {
    if (!isClubAdmin(auth)) fail("permission-denied", "Only administrators can browse organization feeds.");
    const orgs = await db.collection("organizations").limit(501).get();
    if (orgs.size > 500) fail("resource-exhausted", "Organization directory requires pagination.");
    const organizations = rows(orgs).map(o => ({ id: o.id, name: clean(o.name) || o.id })).sort((a,b) => a.name.localeCompare(b.name));
    let players = [];
    if (data.organizationId) {
      const orgId = segment(data.organizationId);
      if (!organizations.some(o => o.id === orgId)) fail("not-found", "Organization not found.");
      const docs = await db.collection("players").where("organizationId", "==", orgId).limit(2001).get();
      if (docs.size > 2000) fail("resource-exhausted", "Roster requires pagination.");
      players = rows(docs).map(p => ({ id: p.id, name: nameOf(p), canPreview: !!ownerUid(p, p.id) })).sort((a,b) => a.name.localeCompare(b.name));
    }
    return { organizations, players };
  }
  async function getContext(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId);
    const org = c.orgId ? await db.collection("organizations").doc(c.orgId).get() : null;
    const team = c.player?.teamId ? await db.collection("teams").doc(c.player.teamId).get() : null;
    return { uid: c.uid, playerId: c.player?.id || null, name: c.displayName, organizationId: c.orgId || null, organizationName: clean(org?.data()?.name), teamId: c.player?.teamId || null, teamName: clean(team?.data()?.name), staff: c.staff, admin: c.admin, enabled: c.enabled, preferences: c.preferences, adminViewer: c.adminViewer || c.admin, previewPlayerId: c.previewPlayerId || null };
  }
  async function getFeed(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId), scope = data.scope || "all";
    if (!["all", "organization", "team", "friends", "mine"].includes(scope)) fail("invalid-argument", "Choose a feed filter.");
    const keys = [];
    if (["all", "organization"].includes(scope) && c.orgId) keys.push(`org:${c.orgId}`);
    if (scope === "team") {
      if (c.player?.teamId) keys.push(`team:${c.player.teamId}`);
      else if (c.staff) for (const id of c.member.teamIds) keys.push(`team:${id}`);
    }
    if (["all", "mine"].includes(scope) && c.player) keys.push(`player:${c.player.id}`);
    if (["all", "friends"].includes(scope)) {
      for (const uid of c.friends) { const p = await resolvePlayer(uid); if (p) keys.push(`player:${p.id}`); }
    }
    if (!keys.length) return { items: [], cursor: null };
    let cursor = data.cursor;
    if (cursor && (!Number.isFinite(cursor.time) || !/^[a-f0-9]{64}$/.test(cursor.id))) fail("invalid-argument", "Invalid feed cursor.");
    const candidates = new Map();
    for (let i = 0; i < keys.length; i += 30) {
      let q = db.collection("socialActivities").where("audiences", "array-contains-any", keys.slice(i, i + 30)).orderBy("occurredAt", "desc").orderBy("id", "desc");
      if (cursor) q = q.startAfter(cursor.time, cursor.id);
      const page = await q.limit(80).get(); rows(page).forEach(a => candidates.set(a.id, a));
    }
    const sorted = [...candidates.values()].sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id));
    const result = []; let last = null, scanned = 0;
    for (const a of sorted) {
      last = a; scanned++;
      const author = await allowed(c, a);
      if (author && a.availableAt <= now()) result.push(await present(c, a, author));
      if (result.length === 20 || scanned === 80) break;
    }
    return { items: result, cursor: last && (scanned < sorted.length || sorted.length >= 80) ? { time: last.occurredAt, id: last.id } : null };
  }
  async function getDetail(data, auth) { const c = await context(auth, data.organizationId, data.viewAsPlayerId), { a, author } = await activity(c, data.id); return present(c, a, author); }
  async function savePreferences(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId);
    if (!c.player) fail("permission-denied", "Only athletes have activity sharing preferences.");
    if (!AUDIENCES.includes(data.audience) || typeof data.automatic !== "boolean" || typeof data.videos !== "boolean") fail("invalid-argument", "Choose valid sharing preferences.");
    await prefsRef(c.uid).set({ audience: data.audience, automatic: data.automatic, videos: data.videos });
    return { ok: true };
  }
  async function setVisibility(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId), { a, author } = await activity(c, data.id);
    if (author.uid !== c.uid) fail("permission-denied", "Only the athlete can change sharing.");
    if (!AUDIENCES.includes(data.audience) || typeof data.hidden !== "boolean") fail("invalid-argument", "Choose an audience.");
    await db.collection("socialActivitySettings").doc(a.id).set({ audience: data.audience, hidden: data.hidden }, { merge: true }); return { ok: true };
  }
  async function people(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId), result = new Map();
    if (c.orgId) {
      let q = db.collection("players").where("organizationId", "==", c.orgId).orderBy("__name__");
      if (data.cursor) q = q.startAfter(segment(data.cursor));
      const docs = await q.limit(50).get(); rows(docs).forEach(p => result.set(p.id, p));
      data = { ...data, next: docs.size === 50 ? docs.docs.at(-1).id : null };
    }
    // Connection links identify one player; never expose a global directory.
    if (data.playerId) { const p = await playerRef(segment(data.playerId)).get(); if (p.exists && ownerUid(p.data(), p.id)) result.set(p.id, { ...p.data(), id: p.id }); }
    if (!data.cursor) for (const edge of c.edges) {
      const uid = edge.participants.find(v => v !== c.uid), p = await resolvePlayer(uid);
      if (p) result.set(p.id, p);
    }
    return { people: [...result.values()].filter(p => !c.blocked.has(ownerUid(p, p.id)) || c.edges.some(e => e.participants.includes(ownerUid(p, p.id)) && e.blockedBy?.includes(c.uid))).map(p => {
      const uid = ownerUid(p, p.id), edge = c.edges.find(e => e.participants.includes(uid));
      return { playerId: p.id, name: nameOf(p), uid, mine: uid === c.uid, sameTeam: !!c.player?.teamId && p.teamId === c.player.teamId,
        relationship: edge?.blockedBy?.includes(c.uid) ? "blocked" : edge?.status === "pending" ? edge.requester === c.uid ? "sent" : "received" : edge?.status || "none" };
    }), cursor: data.next || null };
  }
  async function connect(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId);
    if (!c.player) fail("permission-denied", "Connections require an athlete account.");
    const p = await playerRef(segment(data.playerId)).get(), target = p.exists && ownerUid(p.data(), p.id);
    if (!target || target === c.uid) fail("invalid-argument", "Choose another registered athlete.");
    if ((await prefsRef(target).get()).data()?.accountDeleted === true) fail("permission-denied", "This athlete account is no longer active.");
    const action = data.action;
    if (!["request", "accept", "remove", "block", "unblock"].includes(action)) fail("invalid-argument", "Invalid connection action.");
    await db.runTransaction(async tx => {
      const ref = pairRef(c.uid, target), doc = await tx.get(ref), old = doc.data() || { participants: [c.uid, target].sort(), status: "none", blockedBy: [] };
      let blockedBy = old.blockedBy || [], status = old.status, requester = old.requester || null;
      if (action === "block") { blockedBy = [...new Set([...blockedBy, c.uid])]; status = "none"; }
      else if (action === "unblock") blockedBy = blockedBy.filter(v => v !== c.uid);
      else {
        if (blockedBy.length) fail("permission-denied", "This connection is unavailable.");
        if (action === "request") {
          if (status === "accepted" || status === "pending") return;
          if (c.edges.filter(e => e.status !== "none").length >= 200) fail("resource-exhausted", "You can have up to 200 connections and requests.");
          status = "pending"; requester = c.uid;
        } else if (action === "accept") { if (status === "accepted") return; if (status !== "pending" || requester === c.uid) fail("failed-precondition", "There is no incoming request to accept."); status = "accepted"; }
        else status = "none";
      }
      tx.set(ref, { participants: old.participants, status, requester, blockedBy, updatedAt: now() });
    });
    // An accepted connection brings an outside athlete into the pilot, too.
    // Source reads remain filtered through current audience and connection checks.
    if (action === "accept") { await rebuild(c.player.id); await rebuild(p.id); }
    return { ok: true };
  }
  async function kudos(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId), { a } = await activity(c, data.id);
    if (typeof data.liked !== "boolean") fail("invalid-argument", "Choose a reaction.");
    const ref = db.collection("socialActivities").doc(a.id).collection("kudos").doc(c.uid);
    if (data.liked) await ref.set({ uid: c.uid }); else await ref.delete(); return { ok: true };
  }
  async function comments(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId), { a } = await activity(c, data.id);
    let q = db.collection("socialActivities").doc(a.id).collection("comments").orderBy("createdAt").orderBy("id");
    if (data.cursor) { segment(data.cursor.id); if (!Number.isFinite(data.cursor.time)) fail("invalid-argument", "Invalid comment cursor."); q = q.startAfter(data.cursor.time, data.cursor.id); }
    const page = await q.limit(30).get(), docs = rows(page);
    return { items: docs.filter(r => !c.blocked.has(r.uid)).map(r => ({ ...r, canDelete: r.uid === c.uid || a.authorUid === c.uid || c.admin })), cursor: page.size === 30 ? { time: docs.at(-1).createdAt, id: docs.at(-1).id } : null };
  }
  async function comment(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId), { a, author } = await activity(c, data.id);
    const commentId = segment(data.commentId), ref = db.collection("socialActivities").doc(a.id).collection("comments").doc(commentId);
    await db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      const rateRef = db.collection("socialRateLimits").doc(c.uid), rate = await tx.get(rateRef);
      if (data.remove === true) {
        if (!existing.exists) return;
        if (existing.data().uid !== c.uid && author.uid !== c.uid && !c.admin) fail("permission-denied", "You cannot delete this comment.");
        tx.delete(ref); return;
      }
      const body = clean(data.text, 1001);
      if (!body || body.length > 1000) fail("invalid-argument", "Comments must contain 1–1000 characters.");
      if (existing.exists) { if (existing.data().uid !== c.uid || existing.data().text !== body) fail("already-exists", "Comment identifier already used."); return; }
      if (now() - (rate.data()?.lastComment || 0) < 2000) fail("resource-exhausted", "Please wait a moment before commenting again.");
      tx.set(ref, { id: commentId, uid: c.uid, name: c.displayName, text: body, createdAt: now() }); tx.set(rateRef, { lastComment: now() }, { merge: true });
    }); return { ok: true };
  }
  async function report(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId), { a } = await activity(c, data.id), reason = clean(data.reason, 501);
    if (!reason || reason.length > 500) fail("invalid-argument", "Describe the issue in 1–500 characters.");
    await db.collection("socialReports").doc(idFor(c.uid, a.id)).set({ activityId: a.id, reporterUid: c.uid, reason, createdAt: now(), resolved: false }); return { ok: true };
  }
  async function moderation(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId); if (!c.admin) fail("permission-denied", "Administrator access required.");
    if (!data.id) return { reports: rows(await db.collection("socialReports").where("resolved", "==", false).limit(50).get()) };
    segment(data.id);
    if (typeof data.hidden !== "boolean") fail("invalid-argument", "Choose a moderation action.");
    await db.collection("socialActivitySettings").doc(data.id).set({ moderated: data.hidden }, { merge: true });
    const reports = await db.collection("socialReports").where("activityId", "==", data.id).get();
    const batch = db.batch(); reports.docs.forEach(d => batch.update(d.ref, { resolved: true })); await batch.commit(); return { ok: true };
  }
  async function media(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId), { a, author } = await activity(c, data.id);
    if (author.preferences.videos === false || !a.repIds.length) return { url: null, expiresAt: null };
    const repId = data.repId ? segment(data.repId) : a.repIds[a.repIds.length - 1];
    if (!a.repIds.includes(repId)) fail("permission-denied", "This rep is not part of the activity.");
    const rep = await playerRef(a.playerId).collection("reps").doc(repId).get();
    if (!rep.exists || sessionKey(rep.data()) !== a.sourceId) return { url: null, expiresAt: null };
    let folders; try { folders = storageFolderCandidates(a.playerId, a.drill, rep.data(), bucket.name); } catch { return { url: null, expiresAt: null }; }
    for (const folder of folders) {
      const [files] = await bucket.getFiles({ prefix: folder + "/", maxResults: 30, autoPaginate: false });
      const movie = files.find(f => f.name.startsWith(folder + "/") && !f.name.slice(folder.length + 1).includes("/") && /\.(mp4|mov)$/i.test(f.name));
      if (!movie) continue;
      const expiresAt = now() + 300000, [url] = await movie.getSignedUrl({ action: "read", expires: expiresAt }); return { url, expiresAt };
    }
    return { url: null, expiresAt: null };
  }
  async function rebuild(playerId, dryRun = false) {
    segment(playerId);
    return db.runTransaction(async tx => {
      const p = await tx.get(playerRef(playerId));
      const config = (await tx.get(db.collection("socialSettings").doc("feed"))).data() || {};
      if (p.exists && !((config.allOrganizations === true && playerSegment(p.data().organizationId)) || (config.organizationIds || []).includes(p.data().organizationId))) {
        const uid = ownerUid(p.data(), p.id);
        let connectedToPilot = false;
        if (uid) {
          const edges = await tx.get(db.collection("socialConnections").where("participants", "array-contains", uid).limit(1001));
          if (edges.size > 1000) fail("resource-exhausted", "Too many connections for projection.");
          for (const edge of rows(edges).filter(e => e.status === "accepted" && !e.blockedBy?.length)) {
            const otherUid = edge.participants.find(v => v !== uid);
            for (const field of ["authenticationUID", "userUID"]) {
              const peers = await tx.get(db.collection("players").where(field, "==", otherUid).limit(2));
              if (peers.size === 1 && ownerUid(peers.docs[0].data(), peers.docs[0].id) === otherUid && (config.allOrganizations === true && playerSegment(peers.docs[0].data().organizationId) || (config.organizationIds || []).includes(peers.docs[0].data().organizationId))) connectedToPilot = true;
            }
            if (connectedToPilot) break;
          }
        }
        if (!connectedToPilot) return { skipped: "outside pilot", count: 0 };
      }
      const [reps, logs, sessions, existing, benchmark] = await Promise.all([
        tx.get(playerRef(playerId).collection("reps").limit(2001)), tx.get(playerRef(playerId).collection("workoutLogs").limit(2001)),
        tx.get(playerRef(playerId).collection("trainingSessions").limit(2001)), tx.get(db.collection("socialActivities").where("playerId", "==", playerId).limit(401)),
        tx.get(db.collection("benchmarks").doc("d1")),
      ]);
      if ([reps, logs, sessions].some(s => s.size > 2000) || existing.size > 400) fail("resource-exhausted", "Player history requires a paginated projection migration.");
      const workoutLogs = rows(logs);
      // Legacy completed logs predate pinned snapshots. Read only catalog names
      // for their labels; never publish a current prescription as historical work.
      const catalog = new Map();
      for (const log of workoutLogs.filter(l => !l.workoutSnapshot)) {
        for (const block of log.blocks || []) if (playerSegment(block.drillId)) {
          if (!catalog.has(block.drillId)) { const d = await tx.get(db.collection("drillCatalog").doc(block.drillId)); catalog.set(block.drillId, clean(d.data()?.name || d.data()?.title)); }
          block.name = catalog.get(block.drillId) || clean(block.drillId).replace(/[_-]+/g, " ");
        }
      }
      const projected = p.exists ? projectActivities(playerId, p.data(), rows(reps), workoutLogs, rows(sessions), benchmark.data()?.schemaVersion === 1 && benchmark.data()?.generation >= bundledBenchmarks.generation ? benchmark.data() : bundledBenchmarks, now()).filter(a => a.occurredAt >= (config.historySince || 0)) : [];
      if (projected.length > 400) fail("resource-exhausted", "Too many activities for one projection transaction.");
      let writes = 0;
      for (const a of projected) {
        const old = existing.docs.find(d => d.id === a.id);
        if (old && sameSummary(old.data(), a)) continue;
        writes++; if (!dryRun) tx.set(db.collection("socialActivities").doc(a.id), a);
      }
      const ids = new Set(projected.map(a => a.id));
      for (const d of existing.docs) if (!ids.has(d.id)) { writes++; if (!dryRun) tx.delete(d.ref); }
      if (writes > 450) fail("resource-exhausted", "Projection replacement requires a paginated migration.");
      return { count: projected.length, writes, reps: reps.size, workouts: logs.size, skippedReps: reps.size - projected.reduce((n, a) => n + a.repIds.length, 0) };
    });
  }
  const readOnlyGuard = handler => (data, auth) => {
    if (data.viewAsPlayerId) fail("permission-denied", "Athlete previews are read-only.");
    return handler(data, auth);
  };
  return { adminDirectory, getContext, getFeed, getDetail, people, comments, media, rebuild, context, allowed,
    ...Object.fromEntries(Object.entries({ savePreferences, setVisibility, connect, kudos, comment, report, moderation }).map(([key, handler]) => [key, readOnlyGuard(handler)])) };

}
module.exports = { createSocial, AUDIENCES };
