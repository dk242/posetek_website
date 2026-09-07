"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createClubBranding, publicUrl, publicAddress, logoCandidates, validatePng } = require("./club-branding");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a12cAAAAASUVORK5CYII=", "base64");
const manager = { uid: "manager", email: "manager@example.test", emailVerified: true };

test("logo discovery prioritizes branded images, resolves relative sources and removes duplicates", () => {
  const html = '<meta property="og:image" content="/cover.png"><img alt="Club crest" src="/crest.png"><img alt="Club crest" src="/crest.png"><img alt="logo" src="http://localhost/logo.png">';
  assert.deepEqual(logoCandidates(html, "https://club.example.test/"), ["https://club.example.test/crest.png", "https://club.example.test/cover.png"]);
});

test("fetch destination validation rejects credentials, custom ports, internal names and IP literals", () => {
  for (const url of ["http://club.test", "https://u:p@club.test", "https://club.test:8443", "https://localhost", "https://metadata.google.internal", "https://127.0.0.1", "https://[::1]", "https://2130706433"]) assert.throws(() => publicUrl(url));
  assert.equal(publicUrl("https://club.test/#logo").href, "https://club.test/");
});

test("all DNS answers must be public, including mixed public/private answers", async () => {
  for (const addresses of [["127.0.0.1"], ["169.254.169.254"], ["10.1.1.1"], ["172.16.0.1"], ["192.168.1.1"], ["100.64.0.1"], ["8.8.8.8", "127.0.0.1"], ["::1"], []]) await assert.rejects(publicAddress("club.test", async () => addresses));
  assert.equal(await publicAddress("club.test", async () => ["8.8.8.8"]), "8.8.8.8");
});

test("PNG validation rejects truncated, oversized and non-image responses", () => {
  assert.deepEqual(validatePng(png), { width: 1, height: 1 });
  for (const invalid of [Buffer.from("<script>bad</script>"), png.subarray(0, 45), Buffer.concat([png, Buffer.from("trailer")]), Buffer.alloc(3 * 1024 * 1024)]) assert.throws(() => validatePng(invalid));
  const large = Buffer.from(png); large.writeUInt32BE(5000, 16);
  assert.throws(() => validatePng(large));
});

function setup(actor = { userUID: "manager", role: "manager", teamIds: [], status: "active" }, onRetrieve) {
  const db = new FakeFirestore({ "organizations/club": { schemaVersion: 2, name: "Synthetic Club" }, "organizations/club/members/manager": actor });
  const writes = [], calls = [];
  const bucket = { name: "synthetic.firebasestorage.app", file: (path) => ({ save: async (bytes, options) => writes.push({ path, bytes, options }) }) };
  const retrieve = async (url) => {
    calls.push(url); if (onRetrieve) await onRetrieve(db, calls.length);
    return url.endsWith(".png") ? { buffer: png, contentType: "image/png", url } : { buffer: Buffer.from('<img alt="Club logo" src="/crest.png">'), contentType: "text/html", url };
  };
  return { db, writes, calls, branding: createClubBranding({ db, bucket, FieldValue, HttpsError, retrieve }) };
}

test("manager imports a PNG to immutable Firebase path and publishes metadata, never remote hotlink", async () => {
  const { db, writes, branding } = setup();
  const result = await branding.importClubLogo({ organizationId: "club", websiteUrl: "https://club.test/" }, manager);
  assert.match(result.logoStoragePath, /^organizations\/club\/branding\/[0-9a-f]{64}\.png$/);
  assert.match(result.logoUrl, /^https:\/\/firebasestorage.googleapis.com\//);
  assert.equal(result.logoSourceUrl, "https://club.test/crest.png");
  assert.equal(db.snapshot("organizations/club").logoUrl, result.logoUrl);
  assert.equal(writes.length, 1); assert.deepEqual(writes[0].bytes, png);
  assert.equal(writes[0].options.contentType, "image/png");
});

test("coach, revoked manager and anonymous caller cannot trigger any remote fetch", async () => {
  for (const actor of [{ userUID: "manager", role: "coach", teamIds: ["team"], status: "active" }, { userUID: "manager", role: "manager", teamIds: [], status: "inactive" }]) {
    const { calls, branding } = setup(actor);
    await assert.rejects(branding.importClubLogo({ organizationId: "club", websiteUrl: "https://club.test/" }, manager), { code: "permission-denied" });
    assert.equal(calls.length, 0);
  }
  const { branding } = setup();
  await assert.rejects(branding.importClubLogo({ organizationId: "club", websiteUrl: "https://club.test/" }, { ...manager, isAnonymous: true }), { code: "unauthenticated" });
});

test("authority revoked during download cannot publish club metadata", async () => {
  const { db, writes, branding } = setup(undefined, async (store, count) => {
    if (count === 2) await store.collection("organizations").doc("club").collection("members").doc("manager").update({ status: "inactive" });
  });
  await assert.rejects(branding.importClubLogo({ organizationId: "club", websiteUrl: "https://club.test/" }, manager), { code: "permission-denied" });
  assert.equal(db.snapshot("organizations/club").logoUrl, undefined);
  assert.equal(writes.length, 0);
});
