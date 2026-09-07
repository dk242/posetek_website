"use strict";
// Signed sharing is introduced only for migrated club athletes. This factory
// reuses the reviewed V2 handlers and safe artifact resolver; legacy handlers
// remain in the exact serving index below the dispatch branches.
const { createAthleteShares, ATHLETE_SHARE_COLLECTION } = require("./athlete-shares");
const { playerSegment, storageFolderCandidates } = require("./athlete-storage-paths");
function createClubSharingHandlers({ db, admin, functions, crypto }) {
  const exports = {};
  const athleteShareFunctions = { https: { onCall: (handler) => handler } };
  const athleteShares = createAthleteShares({ db, crypto, Timestamp: admin.firestore.Timestamp,
    HttpsError: functions.https.HttpsError, signingKey: () => process.env.ATHLETE_SHARE_SIGNING_KEY });
  const { athleteShareError } = athleteShares;
  async function verifiedAthleteShare(token, drill) {
    const result = await athleteShares.verifiedAthleteShare(token, drill);
    if (!Object.hasOwn(result.playerDoc.data() || {}, "organizationId")) throw athleteShareError();
    return result;
  }
const ATHLETE_ARTIFACT_URL_TTL_MS = 15 * 60 * 1000;
const ATHLETE_SHARE_REP_TYPES = {
  shooting: new Set(["side_kick", "deadballShot", "shooting"]),
  sprint: new Set(["sprint"]),
  jump: new Set(["jump"]),
  broadJump: new Set(["broadJump"]),
  changeOfDirection: new Set(["changeOfDirection"]),
  dribbling: new Set(["dribbling"]),
  freeRecord: new Set(["freeRecord"]),
};
const ATHLETE_SHARE_ARTIFACTS = {
  shooting: ["pose.json", "metadata.json", "ball_detections.json"],
  sprint: ["pose.json", "metadata.json", "com_midpoints.json", "com_velocity.json"],
  jump: ["pose.json", "metadata.json", "com_height.json", "torso_midpoints.json"],
  broadJump: [
    "pose.json",
    "metadata.json",
    "foot_piecewise_fit.json",
    "key_frames.json",
    "foot_centers.json",
    "com_midpoints.json",
    "com_height.json",
  ],
  changeOfDirection: ["pose.json", "metadata.json"],
  dribbling: ["pose.json", "metadata.json"],
  freeRecord: ["pose.json", "metadata.json", "ball_detections.json"],
};

function requireCaller(context) {
  if (!context.auth?.uid) throw new functions.https.HttpsError("unauthenticated", "Sign in to continue.");
  if (context.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new functions.https.HttpsError("permission-denied", "A registered account is required.");
  }
  return { uid: context.auth.uid, email: context.auth.token?.email || null, emailVerified: context.auth.token?.email_verified === true, isAnonymous: false };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerNumber(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number);
}

function repMatchesDrill(rep, drill) {
  const accepted = ATHLETE_SHARE_REP_TYPES[drill];
  return Boolean(
    accepted && (accepted.has(rep.repType) || accepted.has(rep.drillType))
  );
}

function sanitizedAthleteRep(doc, drill) {
  const data = doc.data() || {};
  const common = {
    id: doc.id,
    repType: drill,
    drillType: drill,
    sessionNumber: integerNumber(data.sessionNumber),
    repNumber: integerNumber(data.repNumber),
    absoluteRepNumber: integerNumber(data.absoluteRepNumber),
    createdAtMillis: data.createdAt?.toMillis?.() || null,
  };
  if (drill === "broadJump") {
    return {
      ...common,
      broadJumpDistance: finiteNumber(data.broadJumpDistance),
      jumpHeight: finiteNumber(data.jumpHeight),
      takeoffFrame: integerNumber(data.takeoffFrame),
      landingFrame: integerNumber(data.landingFrame),
    };
  }
  if (drill === "shooting") {
    return {
      ...common,
      velocity: finiteNumber(data.velocity),
    };
  }
  if (drill === "jump") {
    return {
      ...common,
      jumpHeight: finiteNumber(data.jumpHeight),
    };
  }
  if (drill === "sprint") {
    const maxAcceleration = finiteNumber(data.max_acceleration) ?? finiteNumber(data.maxAcceleration);
    const maxVelocity = finiteNumber(data.max_velocity) ?? finiteNumber(data.maxVelocity);
    return {
      ...common,
      max_acceleration: maxAcceleration,
      maxAcceleration,
      max_velocity: maxVelocity,
      maxVelocity,
      totalTime: finiteNumber(data.totalTime),
    };
  }
  return {
    ...common,
    totalTime: finiteNumber(data.totalTime),
    totalDistance: finiteNumber(data.totalDistance),
    outboundDistance: finiteNumber(data.outboundDistance),
    returnDistance: finiteNumber(data.returnDistance),
    phase1Time: finiteNumber(data.phase1Time),
    phase2Time: finiteNumber(data.phase2Time),
    phase3Time: finiteNumber(data.phase3Time),
    avgBallDistance: finiteNumber(data.avgBallDistance),
    phase1Percent: finiteNumber(data.phase1Percent),
    phase2Percent: finiteNumber(data.phase2Percent),
    phase3Percent: finiteNumber(data.phase3Percent),
    markerDistance: finiteNumber(data.markerDistance),
    startFrame: integerNumber(data.startFrame),
    apexFrame: integerNumber(data.apexFrame),
    endFrame: integerNumber(data.endFrame),
    phase1EndFrame: integerNumber(data.phase1EndFrame),
    phase2EndFrame: integerNumber(data.phase2EndFrame),
  };
}

async function sharedFreeRecordRows(playerDocId) {
  const prefix = `${playerDocId}/freeRecord/`;
  const [files] = await admin.storage().bucket().getFiles({ prefix });
  const grouped = new Map();
  for (const file of files) {
    const relative = file.name.slice(prefix.length);
    const parts = relative.split("/").filter(Boolean);
    if (!parts.length) continue;
    const sessionFolder = parts[0];
    if (!/^session\d+$/i.test(sessionFolder)) continue;
    const repFolder = /^kick\d+$/i.test(parts[1] || "") ? parts[1] : "";
    const key = `${sessionFolder}/${repFolder || "root"}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `freeRecord-${sessionFolder}-${repFolder || "root"}`,
        repType: "freeRecord",
        drillType: "freeRecord",
        sessionFolder,
        repFolder,
        sessionRoot: !repFolder,
        sessionNumber: Number(sessionFolder.replace(/\D/g, "")) || 1,
        repNumber: Number(repFolder.replace(/\D/g, "")) || 1,
        createdAtMillis: file.metadata?.updated
          ? Date.parse(file.metadata.updated)
          : null,
      });
    }
  }
  const rows = [...grouped.values()];
  const sessionsWithRepFolders = new Set(
    rows.filter((row) => !row.sessionRoot).map((row) => row.sessionFolder)
  );
  return rows
    .filter(
      (row) =>
        !row.sessionRoot || !sessionsWithRepFolders.has(row.sessionFolder)
    )
    .sort(
    (left, right) =>
      (right.createdAtMillis || 0) - (left.createdAtMillis || 0) ||
      right.sessionNumber - left.sessionNumber ||
      right.repNumber - left.repNumber
    );
}

/** Creates one accountless athlete-results link; see athlete-shares.js. */
exports.createAthleteResultsShare = athleteShareFunctions.https.onCall((data, context) =>
  athleteShares.createAthleteResultsShare({ ...requireCaller(context), playerDocId: data?.playerDocId })
);

/** Returns whitelisted metrics for a valid accountless share link. */
exports.getAthleteResultsShare = athleteShareFunctions.https.onCall(async (data) => {
  const drill = String(data?.drill || "");
  const { share, playerDoc } = await verifiedAthleteShare(data?.token, drill);
  const playerRef = db.collection("players").doc(share.playerDocId);
  let reps;
  if (drill === "freeRecord") {
    reps = await sharedFreeRecordRows(share.playerDocId);
  } else {
    const repsSnapshot = await playerRef.collection("reps").get();
    reps = repsSnapshot.docs
      .filter((doc) => {
        const rep = doc.data() || {};
        return repMatchesDrill(rep, drill);
      })
      .map((doc) => sanitizedAthleteRep(doc, drill))
      .sort(
        (left, right) =>
          (right.createdAtMillis || 0) - (left.createdAtMillis || 0) ||
          (right.absoluteRepNumber || 0) - (left.absoluteRepNumber || 0)
      );
  }
  const player = playerDoc.data() || {};
  return {
    athlete: {
      firstName: String(player.firstName || "").slice(0, 100),
      lastName: String(player.lastName || "").slice(0, 100),
      name: String(player.name || "").slice(0, 200),
      height: finiteNumber(player.height),
      weight: finiteNumber(player.weight),
    },
    reps,
    expiresAtMillis: share.expiresAt?.toMillis?.() || null,
  };
});

/** Returns 15-minute signed URLs for one permitted rep's JSON artifacts. */
exports.getAthleteSharedRepArtifacts = athleteShareFunctions.https.onCall(async (data) => {
  const drill = String(data?.drill || "");
  const repId = String(data?.repId || "").trim();
  if (!repId || repId.includes("/")) throw athleteShareError();
  const { share } = await verifiedAthleteShare(data?.token, drill);
  const bucket = admin.storage().bucket();
  const fileNames = ATHLETE_SHARE_ARTIFACTS[drill] || [];
  let folders;
  if (drill === "freeRecord") {
    const sessionNumber = integerNumber(data?.sessionNumber);
    const repNumber = integerNumber(data?.repNumber);
    if (!sessionNumber || repNumber === null || repNumber < 0) {
      throw athleteShareError();
    }
    const root = `${share.playerDocId}/freeRecord/session${sessionNumber}`;
    folders = [repNumber === 0 ? root : `${root}/kick${repNumber}`];
  } else {
    const repDoc = await db
      .collection("players")
      .doc(share.playerDocId)
      .collection("reps")
      .doc(repId)
      .get();
    if (!repDoc.exists) throw athleteShareError();
    const rep = repDoc.data() || {};
    if (!repMatchesDrill(rep, drill)) throw athleteShareError();
    try {
      folders = storageFolderCandidates(share.playerDocId, drill, rep, bucket.name);
    } catch (_) {
      throw athleteShareError();
    }
  }
  let selectedFolder = null;
  for (const folder of folders) {
    const [poseExists, metadataExists, listed] = await Promise.all([
      bucket.file(`${folder}/pose.json`).exists().then(([exists]) => exists),
      bucket
        .file(`${folder}/metadata.json`)
        .exists()
        .then(([exists]) => exists),
      bucket.getFiles({ prefix: `${folder}/`, maxResults: 10 }).then(([files]) => files.length > 0),
    ]);
    if (poseExists || metadataExists || listed) {
      selectedFolder = folder;
      break;
    }
  }
  if (!selectedFolder) return { artifactUrls: {}, mediaUrl: null };

  const expires = Date.now() + ATHLETE_ARTIFACT_URL_TTL_MS;
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const file = bucket.file(`${selectedFolder}/${fileName}`);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [url] = await file.getSignedUrl({ action: "read", expires });
      return [fileName, url];
    })
  );
  const [folderFiles] = await bucket.getFiles({ prefix: `${selectedFolder}/` });
  const directFiles = folderFiles.filter((file) => {
    const relative = file.name.slice(selectedFolder.length + 1);
    return relative && !relative.includes("/");
  });
  const movie = directFiles.find((file) => /\.(mov|mp4)$/i.test(file.name));
  const mediaUrl = movie
    ? (await movie.getSignedUrl({ action: "read", expires }))[0]
    : null;
  return {
    artifactUrls: Object.fromEntries(entries.filter(Boolean)),
    mediaUrl,
  };
});


  async function isSignedClubToken(token) {
    if (!athleteShares.validAthleteShareToken(token)) return false;
    const hash = athleteShares.athleteShareTokenHash(token);
    const snapshot = await db.collection(ATHLETE_SHARE_COLLECTION).doc(hash).get();
    if (!snapshot.exists) return false;
    const pid = snapshot.data()?.playerDocId;
    if (!playerSegment(pid)) return true; // Existing malformed V2 records fail signature verification.
    const player = await db.collection("players").doc(pid).get();
    return player.exists && Object.hasOwn(player.data() || {}, "organizationId");
  }
  return { ...exports, isSignedClubToken };
}
module.exports = { createClubSharingHandlers };
