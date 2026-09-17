"use strict";

const { createHash } = require("node:crypto");

// Private deployment configuration maps SHA-256(bucket + newline + object name)
// to the archived object's base64 MD5. Include both copy and rollback paths.
function createRepairGuard(serialized = "{}") {
  const entries = JSON.parse(serialized);
  if (!entries || typeof entries !== "object" || Array.isArray(entries)
      || Object.keys(entries).length > 500
      || Object.entries(entries).some(([key, value]) => !/^[a-f0-9]{64}$/.test(key)
        || typeof value !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(value))) {
    throw new Error("Invalid archived-object repair guard configuration");
  }
  return data => {
    if (!data || typeof data.bucket !== "string" || typeof data.name !== "string") return false;
    const key = createHash("sha256").update(`${data.bucket}\n${data.name}`).digest("hex");
    if (!Object.hasOwn(entries, key)) return false;
    // A known archived path with incomplete event metadata must not be processed.
    // A future upload with different bytes follows the ordinary processor path.
    return !data.md5Hash || entries[key] === data.md5Hash;
  };
}

module.exports = { createRepairGuard };
