"use strict";

const { playerSegment } = require("./athlete-storage-paths");
const { isClubAdmin, activeMember } = require("./club-access");
const { idFor, clean, nameOf, ownerUid, sessionKey, projectActivities, sameSummary } = require("./social-projection");
const { createEffectiveResults, effectiveRep } = require("./effective-results");
const { duplicateIds } = require("./insights-v2-qualification");
const { createProcessingEvidenceReader } = require("./processing-evidence");
const { mapBounded } = require("./insights-v2-projection");
const { createSocialCommunity } = require("./social-community");
const { readSocialOverlay } = require("./social-media-overlay");
const { isDeepStrictEqual } = require("node:util");

const bundledBenchmarks = require("./social-benchmarks.json");
const AUDIENCES = ["organization", "team", "friends", "private"];
const legacyDefaults = { audience: "organization", automatic: true, videos: true };
const defaults = { audience: "private", automatic: false, videos: false };
const preferencesOf = data => data ? { ...legacyDefaults, ...data } : { ...defaults };
const rows = s => s.docs.map(d => ({ ...d.data(), id: d.id }));

function createSocial({ db, bucket, HttpsError, now = Date.now, readEvidence }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const segment = value => { if (!playerSegment(value)) fail("invalid-argument", "Invalid identifier."); return value; };
  const pairRef = (a, b) => db.collection("socialConnections").doc(idFor(...[a, b].sort()));
  const playerRef = id => db.collection("players").doc(id);
  const prefsRef = uid => db.collection("socialPreferences").doc(uid);
  const videoAllowed = author => author.override.audience === "community"
    ? author.override.videos === true && author.override.publishedAt > (author.preferences.videosDisabledAt || 0)
    : author.preferences.videos !== false && author.override.videos !== false;
  // Owners can inspect their own exact saved recording before choosing whether
  // to share it. Audience authorization still runs before every media read.
  const mediaAllowed = (c, author) => author.uid === c.uid || videoAllowed(author);
  const poseShared = (author, repId) => author.override.poseOverlay === true && author.override.poseOverlayOwnerUid === author.uid
    && !!repId && author.override.poseOverlayRepId === repId && videoAllowed(author);
  const overlayAllowed = (c, author, repId) => author.uid === c.uid || poseShared(author, repId);
  const effective = createEffectiveResults({ db, bucket, HttpsError, now, readEvidence });
  const evidenceReader = createProcessingEvidenceReader({ db, bucket, HttpsError, readEvidence });
  const community = createSocialCommunity({ db, now, fail, segment, context, activity, present, playerRef, prefsRef });
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
  async function context(auth, organizationId, viewAsPlayerId, contractVersion) {
    if (contractVersion !== undefined && contractVersion !== 2 && contractVersion !== 1) fail("invalid-argument", "Unsupported community contract.");
    if (viewAsPlayerId) {
      if (!isClubAdmin(auth)) fail("permission-denied", "Only administrators can preview an athlete feed.");
      const target = await playerRef(segment(viewAsPlayerId)).get();
      const uid = target.exists && ownerUid(target.data(), target.id);
      if (!uid) fail("failed-precondition", "This athlete must finish signup before their account can be previewed.");
      if (organizationId && target.data().organizationId !== organizationId) fail("permission-denied", "This athlete belongs to another organization.");
      const c = await context({ uid }, undefined, undefined, contractVersion);
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
    return { uid, player, orgId, staff, admin, member, config, enabled, edges, blocked, friends, version: contractVersion || 1, mediaCache: new Map(), mediaInventories: new Map(), mediaEvidence: new Map(), preferences: preferencesOf(preferences.data()),
      displayName: player ? nameOf(player) : nameOf(member || { firstName: "PoseTek", lastName: "Staff" }) };
  }
  async function currentAuthor(activity) {
    const p = await playerRef(activity.playerId).get();
    if (!p.exists) return null;
    const data = p.data(), uid = ownerUid(data, p.id);
    const preferences = uid ? (await prefsRef(uid).get()).data() : undefined;
    if (preferences?.accountDeleted === true) return null;
    const override = (await db.collection("socialActivitySettings").doc(activity.id).get()).data() || {};
    const savedProfile = (await db.collection("socialCommunityProfiles").doc(p.id).get()).data() || {};
    const profile = savedProfile.consentOwnerUid === uid ? savedProfile : { suspended: savedProfile.suspended === true };
    return { p: data, uid, profile, preferences: preferencesOf(preferences), override };
  }
  async function allowed(c, a, current) {
    // Old summaries predate canonical qualification. A resumable migration
    // replaces them; never serve their stale raw measurements during rollout.
    if (a.kind === "session" && a.schemaVersion !== 2) return null;
    const author = current || await currentAuthor(a);
    if (!author) return null;
    if (author.uid && c.blocked.has(author.uid)) return null;
    if (author.override.moderated === true) return c.admin ? author : null;
    if (author.uid === c.uid || c.admin) return author;
    if (a.availableAt > now()) return null;
    const pref = author.preferences, audience = author.override.audience || pref.audience;
    if (audience === "community") {
      return c.config.communityEnabled === true && author.uid && author.override.publisherUid === author.uid && !author.profile.suspended && author.override.hidden !== true
        && author.override.publishedAt > (author.profile.withdrawnAt || 0) ? author : null;
    }
    if (author.override.hidden === true || audience === "private" || (pref.automatic === false && !author.override.audience)) return null;
    if (a.organizationId !== (author.p.organizationId || "") || a.teamId !== (author.p.teamId || "")) return null;
    if (["organization", "friends"].includes(audience) && author.uid && c.friends.includes(author.uid)) return author;
    if (audience === "organization" && c.orgId && c.orgId === author.p.organizationId) return author;
    if (audience === "team" && c.orgId === author.p.organizationId && (c.player?.teamId === author.p.teamId || (c.staff && (c.member.role === "manager" || c.member.teamIds.includes(author.p.teamId))))) return author;
    return null;
  }
  async function authorizeMutation(tx, c, activityId, permission) {
    const [post, actor, config] = await Promise.all([
      tx.get(db.collection("socialActivities").doc(activityId)),
      c.player ? tx.get(playerRef(c.player.id)) : Promise.resolve(null),
      tx.get(db.collection("socialSettings").doc("feed")),
    ]);
    if (!post.exists || c.player && (!actor.exists || ownerUid(actor.data(), actor.id) !== c.uid)) fail("permission-denied", "This activity or player account is no longer available.");
    const a = { ...post.data(), id: post.id }, authorPlayer = await tx.get(playerRef(a.playerId));
    if (!authorPlayer.exists) fail("permission-denied", "This activity is no longer available.");
    const authorUid = ownerUid(authorPlayer.data(), authorPlayer.id), actorOrg = actor ? actor.data().organizationId || null : c.orgId;
    const [settings, preferences, profile, actorProfile, edge, actorPreferences, member] = await Promise.all([
      tx.get(db.collection("socialActivitySettings").doc(a.id)),
      authorUid ? tx.get(prefsRef(authorUid)) : Promise.resolve(null),
      tx.get(db.collection("socialCommunityProfiles").doc(a.playerId)),
      actor ? tx.get(db.collection("socialCommunityProfiles").doc(actor.id)) : Promise.resolve(null),
      authorUid && authorUid !== c.uid ? tx.get(pairRef(c.uid, authorUid)) : Promise.resolve(null),
      tx.get(prefsRef(c.uid)),
      actorOrg ? tx.get(db.collection("organizations").doc(actorOrg).collection("members").doc(c.uid)) : Promise.resolve(null),
    ]);
    if (actorPreferences.data()?.accountDeleted || preferences?.data()?.accountDeleted || !c.admin && config.data()?.enabled !== true) fail("permission-denied", "This account or community is no longer active.");
    if (["comment", "kudos", "publish"].includes(permission) && (actorProfile?.data()?.suspended
      || !actor && (permission === "publish" || settings.data()?.audience === "community"))) fail("permission-denied", "Community interactions are unavailable for this account.");
    const blocked = new Set(c.blocked), friends = c.friends.filter(uid => uid !== authorUid);
    if (edge?.data()?.blockedBy?.length) blocked.add(authorUid);
    else if (edge?.data()?.status === "accepted") friends.push(authorUid);
    const staff = activeMember(member?.data(), c.uid);
    if (!actor && !c.admin && !staff) fail("permission-denied", "Your club access changed.");
    const savedProfile = profile.data() || {};
    const author = { uid: authorUid, p: authorPlayer.data(), override: settings.data() || {}, preferences: preferencesOf(preferences?.data()),
      profile: savedProfile.consentOwnerUid === authorUid ? savedProfile : { suspended: savedProfile.suspended === true } };
    const current = { ...c, player: actor ? { ...actor.data(), id: actor.id } : null, orgId: actorOrg, staff, member: member?.data(), config: config.data() || {}, blocked, friends };
    if (!await allowed(current, a, author)) fail("permission-denied", "This activity is no longer available to you.");
    if (permission === "comment" && author.override.commentsEnabled === false) fail("permission-denied", "Comments are turned off for this activity.");
    if (permission === "publish" && (authorUid !== c.uid || current.config.communityEnabled !== true || !author.profile.displayName)) fail("permission-denied", "Community publishing is unavailable for this account.");
    return { a, author, actorProfile: actorProfile?.data() };
  }
  async function activity(c, id) {
    const doc = await db.collection("socialActivities").doc(segment(id)).get();
    const a = doc.exists ? { ...doc.data(), id: doc.id } : null;
    const author = a && await allowed(c, a);
    if (!author) fail("permission-denied", "This activity is no longer available to you.");
    return { a, author };
  }
  async function present(c, a, author, includeRepChoices = false) {
    const [kudos, count, comments, team] = await Promise.all([
      db.collection("socialActivities").doc(a.id).collection("kudos").doc(c.uid).get(),
      db.collection("socialActivities").doc(a.id).collection("kudos").count().get(),
      db.collection("socialActivities").doc(a.id).collection("comments").count().get(),
      author.p.teamId ? db.collection("teams").doc(author.p.teamId).get() : null,
    ]);
    const audience = author.override.audience || author.preferences.audience;
    const v2 = c.version === 2;
    if (!v2 && audience === "community") fail("failed-precondition", "Update PoseTek to view this community activity.");
    const published = audience === "community" && author.override.publisherUid === author.uid && author.override.publishedAt > (author.profile.withdrawnAt || 0) && !author.override.hidden && !author.profile.suspended;
    const selectedRepId = a.repIds.includes(author.override.selectedRepId) ? author.override.selectedRepId : a.repIds.at(-1) || null;
    const videoConsent = mediaAllowed(c, author);
    let availableReps = [];
    if (v2 && a.repIds.length) {
      const ids = [...new Set([selectedRepId, ...(includeRepChoices ? a.repIds.slice(-12) : [])])].filter(Boolean);
      if (videoConsent && !c.mediaInventories.has(a.playerId)) c.mediaInventories.set(a.playerId, effective.getMediaInventory(a.playerId));
      const inventory = videoConsent ? await c.mediaInventories.get(a.playerId) : null;
      availableReps = await mapBounded(ids, 4, async id => {
        if (!videoConsent) return { id, label: `Rep ${a.repIds.indexOf(id) + 1}`, canViewVideo: false };
        const cacheKey = `${a.playerId}:${a.drill}:${id}`;
        if (!c.mediaCache.has(cacheKey)) c.mediaCache.set(cacheKey, effective.mediaForPlayer(a.playerId, a.drill, id, { inventory, evidenceCache: c.mediaEvidence, includeArtifacts: false, sign: false, ttlMs: 300000 }));
        let media;
        try { media = await c.mediaCache.get(cacheKey); }
        catch (error) { if (error.code === "not-found") return { id, label: `Rep ${a.repIds.indexOf(id) + 1}`, canViewVideo: false }; throw error; }
        return { id, label: `Rep ${a.repIds.indexOf(id) + 1}`, canViewVideo: videoConsent && media.resultStatus.qualified && !!media.mediaUrl };
      });
    }
    const canViewVideo = v2 ? availableReps.some(r => r.id === selectedRepId && r.canViewVideo) : videoConsent && a.repIds.length > 0;
    const commentsEnabled = author.override.commentsEnabled !== false;
    return { id: a.id, playerId: a.playerId, authorName: audience === "community" ? author.profile.displayName || "Athlete" : nameOf(author.p),
      ...(!v2 ? { authorUid: author.uid } : {}), teamName: audience === "community" && !author.profile.showClub ? "" : clean(team?.data()?.name),
      title: a.title, subtitle: a.subtitle, kind: a.kind, occurredAt: a.occurredAt, metrics: a.metrics, chart: a.chart, score: a.score,
      partial: a.partial, drill: a.drill, repCount: a.repIds.length, canViewVideo,
      mine: author.uid === c.uid, audience, hidden: author.override.hidden === true,
      kudos: count.data().count, liked: kudos.exists, comments: comments.data().count,
      ...(v2 ? { caption: author.override.caption || "", selectedRepId, availableReps, commentsEnabled, poseOverlay: poseShared(author, selectedRepId),
        canComment: commentsEnabled && (!!c.player || audience !== "community" && (c.staff || c.admin)) && !c.previewPlayerId, communityPublished: Boolean(published) } : {}) };
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
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion);
    const org = c.orgId ? await db.collection("organizations").doc(c.orgId).get() : null;
    const team = c.player?.teamId ? await db.collection("teams").doc(c.player.teamId).get() : null;
    return { uid: c.uid, playerId: c.player?.id || null, name: c.displayName, organizationId: c.orgId || null, organizationName: clean(org?.data()?.name), teamId: c.player?.teamId || null, teamName: clean(team?.data()?.name), staff: c.staff, admin: c.admin, enabled: c.enabled, preferences: c.preferences, adminViewer: c.adminViewer || c.admin, previewPlayerId: c.previewPlayerId || null,
      ...(c.version === 2 ? { communityEnabled: c.config.communityEnabled === true } : {}) };
  }
  async function getFeed(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), scope = data.scope || "all";
    if (!["all", "organization", "team", "friends", "mine", ...(c.version === 2 ? ["community"] : [])].includes(scope)) fail("invalid-argument", "Choose a feed filter.");
    if (scope === "community") community.gate(c);
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
    let profileOnly = false;
    if (data.playerId) {
      if (c.version !== 2 || !await community.profileFor(c, data.playerId, true)) fail("permission-denied", "This community profile is unavailable.");
      keys.splice(0, keys.length, `player:${segment(data.playerId)}`);
      profileOnly = data.playerId !== c.player?.id;
    }
    if (scope === "community") keys.splice(0, keys.length, "community");
    if (!keys.length) return { items: [], cursor: null };
    let cursor = data.cursor;
    if (cursor && (!Number.isFinite(cursor.time) || !/^[a-f0-9]{64}$/.test(cursor.id))) fail("invalid-argument", "Invalid feed cursor.");
    const candidates = new Map();
    for (let i = 0; i < keys.length; i += 30) {
      let q = scope === "community" ? db.collection("socialActivities").where("communityPublished", "==", true) : db.collection("socialActivities").where("audiences", "array-contains-any", keys.slice(i, i + 30));
      if (scope === "community" && data.playerId) q = q.where("playerId", "==", data.playerId);
      q = q.orderBy("occurredAt", "desc").orderBy("id", "desc");
      if (cursor) q = q.startAfter(cursor.time, cursor.id);
      const page = await q.limit(80).get(); rows(page).forEach(a => candidates.set(a.id, a));
    }
    const sorted = [...candidates.values()].sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id));
    const result = []; let last = null, scanned = 0;
    for (const a of sorted) {
      last = a; scanned++;
      const author = await allowed(c, a);
      const isCommunity = author?.override.audience === "community";
      if (author && a.availableAt <= now() && !(c.version === 1 && isCommunity)
        && (!(scope === "community" || profileOnly) || isCommunity && author.override.publishedAt > (author.profile.withdrawnAt || 0) && !author.override.hidden && !author.profile.suspended)) result.push(await present(c, a, author));
      if (result.length === 20 || scanned === 80) break;
    }
    const fresh = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion);
    const visible = [];
    for (const item of result) {
      try {
        const current = await activity(fresh, item.id);
        const currentAudience = current.author.override.audience || current.author.preferences.audience;
        if (currentAudience === item.audience && sameSummary(current.a, candidates.get(item.id))) visible.push(item);
      } catch (error) { if (error.code !== "permission-denied") throw error; }
    }
    return { items: visible, cursor: last && (scanned < sorted.length || sorted.length >= 80) ? { time: last.occurredAt, id: last.id } : null };
  }
  async function getDetail(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), initial = await activity(c, data.id);
    const result = await present(c, initial.a, initial.author, true);
    const fresh = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), current = await activity(fresh, data.id);
    if (!sameSummary(initial.a, current.a) || !sameSummary(initial.author.override, current.author.override)) fail("aborted", "This activity changed. Refresh to see its current state.");
    return result;
  }
  async function savePreferences(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion);
    if (!c.player) fail("permission-denied", "Only athletes have activity sharing preferences.");
    if (!AUDIENCES.includes(data.audience) || typeof data.automatic !== "boolean" || typeof data.videos !== "boolean") fail("invalid-argument", "Choose valid sharing preferences.");
    await prefsRef(c.uid).set({ audience: data.audience, automatic: data.automatic, videos: data.videos,
      ...(!data.videos ? { videosDisabledAt: now() } : {}) }, { merge: true });
    return { ok: true };
  }
  async function setVisibility(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), { a, author } = await activity(c, data.id);
    if (author.uid !== c.uid) fail("permission-denied", "Only the athlete can change sharing.");
    if (![...AUDIENCES, ...(c.version === 2 ? ["community"] : [])].includes(data.audience) || typeof data.hidden !== "boolean") fail("invalid-argument", "Choose an audience.");
    const setting = { audience: data.audience, hidden: data.hidden, poseOverlay: false, poseOverlayOwnerUid: null, poseOverlayRepId: null };
    if (data.audience === "community") {
      community.gate(c); await community.enabledActor(c);
      if (!author.profile.displayName) fail("failed-precondition", "Set up your community display name before publishing.");
      if (typeof data.videos !== "boolean" || typeof data.commentsEnabled !== "boolean") fail("invalid-argument", "Choose video and comment permissions for this post.");
      setting.publishedAt = now();
      setting.publisherUid = c.uid;
    }
    if (c.version === 2) {
      if (data.caption !== undefined && (typeof data.caption !== "string" || data.caption.trim().length > 500)) fail("invalid-argument", "Captions can contain up to 500 characters.");
      if (data.selectedRepId !== undefined && data.selectedRepId !== null && !a.repIds.includes(data.selectedRepId)) fail("invalid-argument", "Choose a rep from this activity.");
      if (data.videos !== undefined && typeof data.videos !== "boolean" || data.commentsEnabled !== undefined && typeof data.commentsEnabled !== "boolean") fail("invalid-argument", "Choose valid post permissions.");
      if (data.poseOverlay !== undefined && typeof data.poseOverlay !== "boolean") fail("invalid-argument", "Choose whether to share the pose overlay.");
      if (data.caption !== undefined) setting.caption = clean(data.caption, 500);
      if (data.selectedRepId !== undefined) setting.selectedRepId = data.selectedRepId;
      if (data.videos !== undefined) setting.videos = data.videos;
      if (data.commentsEnabled !== undefined) setting.commentsEnabled = data.commentsEnabled;
      if (data.poseOverlay === true) { setting.poseOverlay = true; setting.poseOverlayOwnerUid = c.uid; }
    }
    await db.runTransaction(async tx => {
      const fresh = await authorizeMutation(tx, c, a.id, data.audience === "community" && !data.hidden ? "publish" : "visibility");
      if (fresh.author.uid !== c.uid) fail("permission-denied", "Only the athlete can change sharing.");
      if (setting.selectedRepId && !fresh.a.repIds.includes(setting.selectedRepId)) fail("failed-precondition", "This rep is no longer part of the activity.");
      if (setting.poseOverlay && (!fresh.a.repIds.length || !videoAllowed({ ...fresh.author, override: { ...fresh.author.override, ...setting } }))) fail("invalid-argument", "Share a recorded video before including its pose overlay.");
      if (setting.poseOverlay) {
        const selected = Object.hasOwn(setting, "selectedRepId") ? setting.selectedRepId : fresh.author.override.selectedRepId;
        setting.poseOverlayRepId = fresh.a.repIds.includes(selected) ? selected : fresh.a.repIds.at(-1);
      }
      tx.set(db.collection("socialActivitySettings").doc(a.id), setting, { merge: true });
      tx.update(db.collection("socialActivities").doc(a.id), { communityPublished: data.audience === "community" && !data.hidden });
    }); return { ok: true };
  }
  async function people(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), result = new Map();
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
    const people = [];
    for (const p of result.values()) {
      const uid = ownerUid(p, p.id), edge = c.edges.find(e => e.participants.includes(uid));
      if (c.blocked.has(uid) && !edge?.blockedBy?.includes(c.uid)) continue;
      const established = uid === c.uid || c.orgId && c.orgId === p.organizationId || c.friends.includes(uid);
      let name = nameOf(p);
      if (!established) {
        const minimal = await community.profileFor(c, p.id, true);
        if (!minimal && edge?.status !== "pending" && !edge?.blockedBy?.includes(c.uid)) continue;
        name = minimal?.displayName || [clean(p.firstName, 40), clean(p.lastName, 1)].filter(Boolean).join(" ") || "Athlete";
      }
      people.push({ playerId: p.id, name, uid: established ? uid : null, canConnect: !!uid, mine: uid === c.uid,
        sameTeam: !!c.player?.teamId && p.teamId === c.player.teamId && p.organizationId === c.orgId,
        relationship: edge?.blockedBy?.includes(c.uid) ? "blocked" : edge?.status === "pending" ? edge.requester === c.uid ? "sent" : "received" : edge?.status || "none" });
    }
    return { people, cursor: data.next || null };
  }
  async function connect(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion);
    if (!c.player) fail("permission-denied", "Connections require an athlete account.");
    if (["request", "accept"].includes(data.action)) { await community.enabledActor(c); await community.rate(c, "connections", 10); }
    const p = await playerRef(segment(data.playerId)).get(), target = p.exists && ownerUid(p.data(), p.id);
    if (!target || target === c.uid) fail("invalid-argument", "Choose another registered athlete.");
    if ((await prefsRef(target).get()).data()?.accountDeleted === true) fail("permission-denied", "This athlete account is no longer active.");
    const action = data.action;
    if (!["request", "accept", "remove", "block", "unblock"].includes(action)) fail("invalid-argument", "Invalid connection action.");
    await db.runTransaction(async tx => {
      const ref = pairRef(c.uid, target), doc = await tx.get(ref), old = doc.data() || { participants: [c.uid, target].sort(), status: "none", blockedBy: [] };
      if (["request", "accept"].includes(action)) {
        const [actor, other, actorProfile, otherProfile, actorPrefs, otherPrefs] = await Promise.all([
          tx.get(playerRef(c.player.id)), tx.get(playerRef(p.id)),
          tx.get(db.collection("socialCommunityProfiles").doc(c.player.id)), tx.get(db.collection("socialCommunityProfiles").doc(p.id)),
          tx.get(prefsRef(c.uid)), tx.get(prefsRef(target)),
        ]);
        if (!actor.exists || ownerUid(actor.data(), actor.id) !== c.uid || !other.exists || ownerUid(other.data(), other.id) !== target
          || actorProfile.data()?.suspended || otherProfile.data()?.suspended || actorPrefs.data()?.accountDeleted || otherPrefs.data()?.accountDeleted) fail("permission-denied", "This connection is unavailable.");
      }
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
      if (["request", "accept"].includes(action)) {
        const event = community.notification(tx, target, action === "accept" ? "accepted" : "request", c.player.id, ref.id);
        tx.set(event.ref, event.data);
      }
    });
    // An accepted connection brings an outside athlete into the pilot, too.
    // Source reads remain filtered through current audience and connection checks.
    if (action === "accept") { await rebuild(c.player.id); await rebuild(p.id); }
    return { ok: true };
  }
  async function kudos(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), { a, author } = await activity(c, data.id);
    if (c.player || author.override.audience === "community") await community.enabledActor(c);
    if (typeof data.liked !== "boolean") fail("invalid-argument", "Choose a reaction.");
    const ref = db.collection("socialActivities").doc(a.id).collection("kudos").doc(c.uid);
    await db.runTransaction(async tx => {
      const fresh = await authorizeMutation(tx, c, a.id, "kudos");
      const old = await tx.get(ref);
      const event = fresh.author.uid && fresh.author.uid !== c.uid ? community.notification(tx, fresh.author.uid, "kudos", c.player?.id || null, a.id, { activityId: a.id, ...(c.player ? {} : { actorUid: c.uid }) }) : null;
      const notification = event ? await tx.get(event.ref) : null;
      if (data.liked) {
        if (!old.exists) tx.set(ref, { uid: c.uid });
        if (event && !notification.exists) tx.set(event.ref, event.data);
      } else tx.delete(ref);
    }); return { ok: true };
  }
  async function comments(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), { a, author } = await activity(c, data.id);
    const isCommunity = author.override.audience === "community";
    if (isCommunity && c.version !== 2) fail("failed-precondition", "Update PoseTek to view community comments.");
    let q = db.collection("socialActivities").doc(a.id).collection("comments").orderBy("createdAt").orderBy("id");
    if (data.cursor) { segment(data.cursor.id); if (!Number.isFinite(data.cursor.time)) fail("invalid-argument", "Invalid comment cursor."); q = q.startAfter(data.cursor.time, data.cursor.id); }
    const page = await q.limit(30).get(), docs = rows(page);
    const items = await mapBounded(docs.filter(r => !c.blocked.has(r.uid)), 6, async r => {
      let name = r.displayName || r.name;
      if (isCommunity) {
        let person;
        try { person = await resolvePlayer(r.uid); } catch (error) { if (!["permission-denied", "failed-precondition"].includes(error.code)) throw error; }
        const profile = person ? (await db.collection("socialCommunityProfiles").doc(person.id).get()).data() : null;
        name = profile?.consentOwnerUid === r.uid && profile.displayName || (person ? [clean(person.firstName, 40), clean(person.lastName, 1)].filter(Boolean).join(" ") : "") || "Athlete";
      }
      return { ...(c.version === 2 ? { id: r.id, name, text: r.text, createdAt: r.createdAt } : r), canDelete: r.uid === c.uid || author.uid === c.uid || c.admin, _actorUid: r.uid };
    });
    const fresh = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion);
    await activity(fresh, a.id);
    return { items: items.filter(row => !fresh.blocked.has(row._actorUid)).map(({ _actorUid, ...row }) => row), cursor: page.size === 30 ? { time: docs.at(-1).createdAt, id: docs.at(-1).id } : null };
  }
  async function comment(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), { a, author } = await activity(c, data.id);
    if (data.remove !== true) {
      if (c.player || author.override.audience === "community") await community.enabledActor(c);
      if (author.override.commentsEnabled === false) fail("permission-denied", "Comments are turned off for this activity.");
    }
    const commentId = segment(data.commentId), ref = db.collection("socialActivities").doc(a.id).collection("comments").doc(commentId);
    await db.runTransaction(async tx => {
      const fresh = await authorizeMutation(tx, c, a.id, data.remove === true ? "removeComment" : "comment");
      const existing = await tx.get(ref);
      const rateRef = db.collection("socialRateLimits").doc(c.uid), rate = await tx.get(rateRef);
      const profile = fresh.actorProfile;
      if (data.remove === true) {
        if (!existing.exists) return;
        if (existing.data().uid !== c.uid && fresh.author.uid !== c.uid && !c.admin) fail("permission-denied", "You cannot delete this comment.");
        tx.delete(ref); return;
      }
      const body = clean(data.text, 1001);
      if (!body || body.length > 1000) fail("invalid-argument", "Comments must contain 1–1000 characters.");
      if (existing.exists) { if (existing.data().uid !== c.uid || existing.data().text !== body) fail("already-exists", "Comment identifier already used."); return; }
      if (now() - (rate.data()?.lastComment || 0) < 2000) fail("resource-exhausted", "Please wait a moment before commenting again.");
      const displayName = c.player ? (profile?.consentOwnerUid === c.uid && profile.displayName) || [clean(c.player.firstName, 40), clean(c.player.lastName, 1)].filter(Boolean).join(" ") || "Athlete" : "PoseTek staff";
      tx.set(ref, { id: commentId, uid: c.uid, name: c.displayName, displayName, text: body, createdAt: now() }); tx.set(rateRef, { lastComment: now() }, { merge: true });
      if (fresh.author.uid && fresh.author.uid !== c.uid) {
        const event = community.notification(tx, fresh.author.uid, "comment", c.player?.id || null, commentId, { activityId: a.id, ...(c.player ? {} : { actorUid: c.uid }) });
        tx.set(event.ref, event.data);
      }
    }); return { ok: true };
  }
  async function report(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), { a } = await activity(c, data.id), reason = clean(data.reason, 501);
    if (!reason || reason.length > 500) fail("invalid-argument", "Describe the issue in 1–500 characters.");
    await db.collection("socialReports").doc(idFor(c.uid, a.id)).set({ activityId: a.id, reporterUid: c.uid, reason, createdAt: now(), resolved: false }); return { ok: true };
  }
  async function moderation(data, auth) {
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion); if (!c.admin) fail("permission-denied", "Administrator access required.");
    if (!data.id) return { reports: rows(await db.collection("socialReports").where("resolved", "==", false).limit(50).get()).filter(r => !r.targetType || r.targetType === "activity") };
    segment(data.id);
    if (typeof data.hidden !== "boolean") fail("invalid-argument", "Choose a moderation action.");
    await db.collection("socialActivitySettings").doc(data.id).set({ moderated: data.hidden }, { merge: true });
    const reports = await db.collection("socialReports").where("activityId", "==", data.id).get();
    const batch = db.batch(); reports.docs.forEach(d => batch.update(d.ref, { resolved: true })); await batch.commit(); return { ok: true };
  }
  async function media(data, auth) {
    if (data.includeOverlay !== undefined && typeof data.includeOverlay !== "boolean") fail("invalid-argument", "Choose whether to include the pose overlay.");
    const includeOverlay = data.includeOverlay === true;
    const unavailable = () => ({ url: null, expiresAt: null, ...(includeOverlay ? { overlay: null } : {}) });
    const c = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion), { a, author } = await activity(c, data.id);
    const consent = mediaAllowed(c, author);
    if (!consent || !a.repIds.length) return unavailable();
    const repId = data.repId ? segment(data.repId) : a.repIds.includes(author.override.selectedRepId) ? author.override.selectedRepId : a.repIds.at(-1);
    if (!a.repIds.includes(repId)) fail("permission-denied", "This rep is not part of the activity.");
    const rep = await playerRef(a.playerId).collection("reps").doc(repId).get();
    if (!rep.exists || sessionKey(rep.data()) !== a.sourceId) return unavailable();
    let overlay = null, recording = null;
    const result = await effective.mediaForPlayer(a.playerId, a.drill, repId, { ttlMs: 300000, includeArtifacts: false,
      ...(includeOverlay && overlayAllowed(c, author, repId) ? { onRecording: async source => { recording = source; overlay = await readSocialOverlay(source, bucket); } } : {}) });
    // Slow optional artifact reads must not return an overlay from a rep,
    // revision, qualification, context or selected video that changed meanwhile.
    if (includeOverlay && recording) {
      let currentRecording = null;
      try {
        await effective.mediaForPlayer(a.playerId, a.drill, repId, { includeArtifacts: false, sign: false, onRecording: source => { currentRecording = source; } });
      } catch (error) { if (error.code !== "not-found") throw error; }
      if (!currentRecording || !isDeepStrictEqual(recording, currentRecording)) return unavailable();
    }
    const fresh = await context(auth, data.organizationId, data.viewAsPlayerId, data.contractVersion);
    const { a: currentActivity, author: current } = await activity(fresh, data.id);
    const currentRep = await playerRef(a.playerId).collection("reps").doc(repId).get();
    const selectedNow = currentActivity.repIds.includes(current.override.selectedRepId) ? current.override.selectedRepId : currentActivity.repIds.at(-1);
    const bindingCurrent = currentActivity.playerId === a.playerId && currentActivity.drill === a.drill && currentActivity.sourceId === a.sourceId
      && currentActivity.repIds.includes(repId) && (data.repId || selectedNow === repId) && currentRep.exists && isDeepStrictEqual(rep.data(), currentRep.data());
    return result.resultStatus.qualified && mediaAllowed(fresh, current) && bindingCurrent && result.mediaUrl && result.expiresAtMillis > now()
      ? { url: result.mediaUrl, expiresAt: result.expiresAtMillis, ...(includeOverlay ? { overlay: overlayAllowed(fresh, current, repId) ? overlay : null } : {}) } : unavailable();
  }
  async function rebuild(playerId, dryRun = false, options = {}) {
    segment(playerId);
    return db.runTransaction(async tx => {
      const p = await tx.get(playerRef(playerId));
      const config = (await tx.get(db.collection("socialSettings").doc("feed"))).data() || {};
      if (p.exists && !((config.communityEnabled === true || options.includeCommunity === true) && ownerUid(p.data(), p.id)) && !((config.allOrganizations === true && playerSegment(p.data().organizationId)) || (config.organizationIds || []).includes(p.data().organizationId))) {
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
      const [reps, logs, sessions, existing, benchmark, failureDocs, corrections] = await Promise.all([
        tx.get(playerRef(playerId).collection("reps").limit(2001)), tx.get(playerRef(playerId).collection("workoutLogs").limit(2001)),
        tx.get(playerRef(playerId).collection("trainingSessions").limit(2001)), tx.get(db.collection("socialActivities").where("playerId", "==", playerId).limit(401)),
        tx.get(db.collection("benchmarks").doc("d1")),
        tx.get(db.collection("failureCases").where("playerDocumentID", "==", playerId).limit(2001)),
        tx.get(playerRef(playerId).collection("insightMetadata").doc("resultCorrections")),
      ]);
      if ([reps, logs, sessions, failureDocs].some(s => s.size > 2000) || existing.size > 400) fail("resource-exhausted", "Player history requires a paginated projection migration.");
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
      const rawReps = rows(reps), duplicate = duplicateIds(rawReps, corrections.data()), evidenceCache = new Map();
      const qualifiedReps = await mapBounded(rawReps, 8, async rep => {
        const evidence = duplicate.has(rep.id) ? {} : await evidenceReader.readEvidence(playerId, rep, evidenceCache, rows(failureDocs));
        if (rep.adminRevision?.revisionId && playerSegment(rep.adminRevision.revisionId)) evidence.revision = (await tx.get(playerRef(playerId).collection("reps").doc(rep.id).collection("revisions").doc(rep.adminRevision.revisionId))).data();
        return { ...rep, ...effectiveRep(rep, evidence, duplicate.has(rep.id)) };
      });
      const projected = p.exists ? projectActivities(playerId, p.data(), qualifiedReps, workoutLogs, rows(sessions), benchmark.data()?.schemaVersion === 1 && benchmark.data()?.generation >= bundledBenchmarks.generation ? benchmark.data() : bundledBenchmarks, now()).filter(a => a.occurredAt >= (config.historySince || 0)) : [];
      if (projected.length > 400) fail("resource-exhausted", "Too many activities for one projection transaction.");
      let writes = 0;
      for (const a of projected) {
        const old = existing.docs.find(d => d.id === a.id);
        if (old?.data()?.communityPublished !== undefined) a.communityPublished = old.data().communityPublished;
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
    getCommunityProfile: community.getProfile, discovery: community.discover, inbox: community.getInbox,
    ...Object.fromEntries(Object.entries({ savePreferences, setVisibility, connect, kudos, comment, report, moderation,
      saveCommunityProfile: community.saveProfile, withdrawCommunityPosts: community.withdraw, markInboxRead: community.markRead,
      reportContent: community.reportContent, moderateContent: community.moderate }).map(([key, handler]) => [key, readOnlyGuard(handler)])) };

}
module.exports = { createSocial, AUDIENCES };
