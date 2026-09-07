"use strict";

const STORAGE_DRILLS = Object.freeze({
  shooting: "deadballShot", sprint: "sprint", jump: "jump", broadJump: "broadJump",
  changeOfDirection: "changeOfDirection", dribbling: "dribbling", freeRecord: "freeRecord",
});
const RESERVED = new Set(["diagnostics", "failure_cases", "trainingPlanContexts", "drillCatalogMedia", "kicking-analysis"]);

function playerSegment(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !RESERVED.has(value);
}

function positiveNumber(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid recording number");
  return number;
}

// Runs at the Admin-SDK signing boundary, including for historic rep documents
// created while Firestore was public. Rules on new writes cannot sanitize those.
function storageFolderCandidates(playerId, drill, rep, bucketName) {
  if (!playerSegment(playerId) || !Object.hasOwn(STORAGE_DRILLS, drill)) {
    throw new Error("Invalid recording owner");
  }
  const prefix = `${playerId}/${STORAGE_DRILLS[drill]}/`;
  const folders = [];
  if (rep.storagePath !== undefined && rep.storagePath !== null && rep.storagePath !== "") {
    if (typeof rep.storagePath !== "string") throw new Error("Invalid recording path");
    let path = rep.storagePath;
    if (path.startsWith("gs://")) {
      const expected = `gs://${bucketName}/`;
      if (!path.startsWith(expected)) throw new Error("Invalid recording bucket");
      path = path.slice(expected.length);
    }
    if (!path.startsWith(prefix) || /[\\%?#\u0000-\u001f]/.test(path)) {
      throw new Error("Recording path is outside the shared athlete and drill");
    }
    const suffix = path.slice(prefix.length).replace(/\/$/, "");
    const match = /^(session[1-9]\d*)(?:\/(kick[1-9]\d*))?(?:\/([A-Za-z0-9_.-]+\.(?:mov|mp4|json)))?$/i.exec(suffix);
    if (!match || suffix.split("/").some(part => part === "." || part === "..")) {
      throw new Error("Invalid recording path");
    }
    folders.push(prefix + match[1] + (match[2] ? "/" + match[2] : ""));
  }
  folders.push(`${prefix}session${positiveNumber(rep.sessionNumber, 1)}/kick${positiveNumber(rep.repNumber, 1)}`);
  return [...new Set(folders)];
}

module.exports = { playerSegment, storageFolderCandidates };
