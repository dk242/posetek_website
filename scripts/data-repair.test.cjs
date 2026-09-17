"use strict";
// Synthetic fixtures only; no live Firebase, credentials or athlete records.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { RepairRunner, GoogleApi, validateManifest, hash, executeMode, firestoreFieldsEqual } = require("./data-repair.cjs");

const clone = value => structuredClone(value);
const md5 = bytes => crypto.createHash("md5").update(bytes).digest("base64");
const project = "demo-repair-fixture", bucket = "demo-repair-fixture.test";
const root = `projects/${project}/databases/(default)/documents/`;
const fields = name => ({ name: { stringValue: name }, nested: { mapValue: { fields: { n: { integerValue: "42" } } } } });
function doc(p, f, time = "original-time") { return { name: root + p, fields: clone(f), createTime: "original-create", updateTime: time }; }
function omitEmptyContainers(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(omitEmptyContainers);
  const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, omitEmptyContainers(v)]));
  if (result.mapValue?.fields && Object.keys(result.mapValue.fields).length === 0) delete result.mapValue.fields;
  if (result.arrayValue?.values?.length === 0) delete result.arrayValue.values;
  return result;
}

class FakeApi {
  constructor() { this.docs = new Map(); this.objects = new Map(); this.mutations = []; this.serial = 100; this.commits = 0; }
  putObject(name, bytes, generation = "10", metadata = {}) {
    const data = Buffer.from(bytes);
    this.objects.set(name, { bytes: data, meta: { name, generation, size: String(data.length), md5Hash: md5(data), contentType: "application/octet-stream", metadata: { preserved: "yes" }, ...metadata } });
  }
  async getDoc(_m, p) { const result = clone(this.docs.get(p) || null); return this.normalizeContainers ? omitEmptyContainers(result) : result; }
  async meta(_m, p) { return clone(this.objects.get(p)?.meta || null); }
  async download(_m, p, generation, file) {
    const object = this.objects.get(p); assert.ok(object, "download target exists"); assert.equal(String(object.meta.generation), String(generation));
    await fs.writeFile(file, this.corruptDownload ? Buffer.from("corrupt") : object.bytes, { flag: "wx" });
  }
  async commit(_m, writes) {
    this.commits++;
    if (this.beforeCommit) await this.beforeCommit(this, writes);
    for (const w of writes) {
      const p = (w.update?.name || w.delete).slice(root.length), original = this.docs.get(p);
      if (w.currentDocument.exists === false && original) throw Error("exists guard");
      if (w.currentDocument.updateTime && original?.updateTime !== w.currentDocument.updateTime) throw Error("updateTime guard");
    }
    const updateTime = `commit-${++this.serial}`;
    for (const w of writes) {
      const p = (w.update?.name || w.delete).slice(root.length), original = this.docs.get(p);
      if (w.delete) this.docs.delete(p);
      else this.docs.set(p, { ...doc(p, w.update.fields, updateTime), createTime: original?.createTime || updateTime });
    }
    this.mutations.push({ kind: "commit", writes: clone(writes) });
    if (this.loseCommit === this.commits) throw Error("lost commit acknowledgement");
    return { commitTime: updateTime };
  }
  async copy(m, source, destination, generation, metadata) {
    assert.equal(this.objects.get(source)?.meta.generation, String(generation)); assert.equal(this.objects.has(destination), false);
    this.putObject(destination, this.objects.get(source).bytes, String(++this.serial), metadata);
    this.mutations.push({ kind: "copy", source, destination });
    if (this.loseCopy) { this.loseCopy = false; throw Error("lost copy acknowledgement"); }
    return this.meta(m, destination);
  }
  async upload(m, destination, file, metadata, generation = "0") {
    if (String(generation) === "0") assert.equal(this.objects.has(destination), false, "create-only upload");
    else assert.equal(this.objects.get(destination)?.meta.generation, String(generation), "generation guarded upload");
    this.putObject(destination, await fs.readFile(file), String(++this.serial), metadata);
    this.mutations.push({ kind: "upload", destination, generation });
    if (this.loseUpload) { this.loseUpload = false; throw Error("lost upload acknowledgement"); }
    return this.meta(m, destination);
  }
  async deleteObject(_m, name, generation) {
    assert.equal(this.objects.get(name)?.meta.generation, String(generation));
    if (this.failDelete) { this.failDelete = false; throw Error("delete unavailable"); }
    this.objects.delete(name); this.mutations.push({ kind: "delete", name, generation });
    if (this.loseDelete) { this.loseDelete = false; throw Error("lost delete acknowledgement"); }
  }
}

async function fixture(t, { inPlace = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "posetek-repair-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const api = new FakeApi();
  api.docs.set("players/source/reps/rep-a", doc("players/source/reps/rep-a", fields("old-owner")));
  api.docs.set("organizations/club", doc("organizations/club", fields("club")));
  api.putObject("source/rep-a/video.mov", Buffer.from([0, 5, 255, 22]));
  api.putObject("source/rep-a/context.json", JSON.stringify({ playerId: "source", value: 12 }), "11", { contentType: "application/json" });
  const objects = [
    { source: "source/rep-a/video.mov", destination: "destination/rep-a/video.mov", generation: "10", md5Hash: (await api.meta(null, "source/rep-a/video.mov")).md5Hash },
    { source: "source/rep-a/context.json", destination: "destination/rep-a/context.json", generation: "11", md5Hash: (await api.meta(null, "source/rep-a/context.json")).md5Hash, afterJson: { playerId: "destination", value: 12 } },
  ];
  const cleanupObjects = objects.map(o => ({ name: o.source, generation: o.generation, md5Hash: o.md5Hash }));
  if (inPlace) {
    api.putObject("failure_cases/report-a/report.json", JSON.stringify({ playerId: "source" }), "12", { contentType: "application/json" });
    objects.push({ source: "failure_cases/report-a/report.json", destination: "failure_cases/report-a/report.json", generation: "12", md5Hash: (await api.meta(null, "failure_cases/report-a/report.json")).md5Hash, replaceExisting: true, afterJson: { playerId: "destination" } });
  }
  const manifest = { version: 1, id: "synthetic-repair", project, bucket, markerPath: "organizations/club/migrations/synthetic-repair", objects, cleanupObjects,
    documents: [
      { path: "players/destination/reps/rep-a", phase: "prepare", before: null, afterFields: fields("new-owner") },
      { path: "players/source/reps/rep-a", phase: "cutover", before: await api.getDoc(null, "players/source/reps/rep-a"), afterFields: null },
      { path: "organizations/club", before: await api.getDoc(null, "organizations/club"), afterFields: fields("club-with-manager") },
      { path: "organizations/club/members/manager", before: null, afterFields: fields("manager") },
    ] };
  return { api, manifest, directory, runner: () => new RepairRunner(manifest, api, directory) };
}

test("dry-run checks complete before-images and object generations without mutations or local evidence", async t => {
  const f = await fixture(t); const result = await f.runner().dryRun();
  assert.equal(result.status, "dry-run-verified"); assert.equal(f.api.mutations.length, 0); assert.deepEqual(await fs.readdir(f.directory), []);
});

test("Firestore comparison permits only absent empty typed container members and retains strict scalar/field differences", () => {
  const explicit = { stats: { mapValue: { fields: {} } }, teams: { arrayValue: { values: [] } }, nested: { arrayValue: { values: [{ mapValue: { fields: { inner: { arrayValue: { values: [] } } } } }] } } };
  const normalized = omitEmptyContainers(explicit), originalHash = hash(explicit);
  assert.equal(firestoreFieldsEqual(explicit, normalized), true);
  assert.equal(hash(explicit), originalHash); assert.notEqual(hash(normalized), originalHash);
  for (const other of [
    { x: { arrayValue: {} } }, { x: { nullValue: null } }, {},
    { x: { mapValue: { fields: null } } }, { x: { mapValue: { fields: { added: { stringValue: "yes" } } } } },
  ]) assert.equal(firestoreFieldsEqual({ x: { mapValue: {} } }, other), false);
  assert.equal(firestoreFieldsEqual({ x: { integerValue: "1" } }, { x: { doubleValue: 1 } }), false);
});

test("normalized nested empty containers resume committed cutover without changing manifest hash or repeating document writes", async t => {
  const f = await fixture(t);
  const empty = { stats: { mapValue: { fields: {} } }, best_reps: { mapValue: { fields: {} } }, teamIds: { arrayValue: { values: [] } }, nested: { mapValue: { fields: { deep: { arrayValue: { values: [{ mapValue: { fields: {} } }] } } } } } };
  for (const d of f.manifest.documents) {
    if (d.before) { Object.assign(d.before.fields, clone(empty)); Object.assign(f.api.docs.get(d.path).fields, clone(empty)); }
    if (d.afterFields) Object.assign(d.afterFields, clone(empty));
  }
  const manifestHash = validateManifest(f.manifest), exactManifest = JSON.stringify(f.manifest);
  f.api.normalizeContainers = true;
  const runner = f.runner(), originalReadback = runner.recordDocuments;
  runner.recordDocuments = async function (list) {
    if (list.some(d => d.phase !== "prepare")) throw Error("simulated stop after atomic cutover");
    return originalReadback.call(this, list);
  };
  await assert.rejects(runner.apply(), /simulated stop/);
  assert.ok(f.api.docs.has(f.manifest.markerPath)); assert.equal(f.api.commits, 2);
  assert.equal((await f.runner().apply()).status, "verified"); assert.equal(f.api.commits, 2);
  assert.equal(JSON.stringify(f.manifest), exactManifest); assert.equal(validateManifest(f.manifest), manifestHash);
  const journal = JSON.parse(await fs.readFile(path.join(f.directory, "journal.json"), "utf8"));
  assert.equal(journal.manifestHash, manifestHash);
  for (const d of f.manifest.documents) assert.equal(journal.documents[d.path].fieldsHash, hash(d.afterFields));
  await f.runner().rollback();
  for (const d of f.manifest.documents) assert.equal(firestoreFieldsEqual((await f.api.getDoc(null, d.path))?.fields || null, d.before?.fields || null), true);
});

test("authorization proves object reads separately from bucket create/delete permissions", async t => {
  const f = await fixture(t), api = new GoogleApi("synthetic-not-a-credential"), requests = [];
  api.request = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes("cloudresourcemanager")) return { permissions: ["datastore.entities.get", "datastore.entities.create", "datastore.entities.update", "datastore.entities.delete"] };
    if (url.includes("testPermissions")) return { permissions: ["storage.objects.create", "storage.objects.delete"] };
    if (url.includes("alt=media")) return { arrayBuffer: async () => new ArrayBuffer(1) };
    return f.api.meta(null, "source/rep-a/video.mov");
  };
  await api.authorize(f.manifest);
  const media = requests.find(x => x.url.includes("alt=media")); assert.equal(media.options.headers.Range, "bytes=0-0");
  assert.ok(requests.every(x => !x.url.includes("upload")));
  api.request = async url => url.includes("cloudresourcemanager") ? { permissions: ["datastore.entities.get", "datastore.entities.create", "datastore.entities.update", "datastore.entities.delete"] } : { permissions: ["storage.objects.create"] };
  await assert.rejects(api.authorize(f.manifest), /bucket data permissions/);
});

test("CLI mode dispatch authorizes verify, repeated apply and rollback after original source cleanup", async t => {
  const f = await fixture(t), probes = [];
  f.api.authorize = GoogleApi.prototype.authorize;
  f.api.request = async url => {
    if (url.includes("cloudresourcemanager")) return { permissions: ["datastore.entities.get", "datastore.entities.create", "datastore.entities.update", "datastore.entities.delete"] };
    if (url.includes("testPermissions")) return { permissions: ["storage.objects.create", "storage.objects.delete"] };
    assert.ok(url.includes("alt=media"));
    const parsed = new URL(url), name = decodeURIComponent(parsed.pathname.split("/o/")[1]), generation = parsed.searchParams.get("generation");
    assert.equal(f.api.objects.get(name)?.meta.generation, generation, "auth uses an extant verified object generation");
    probes.push(name); return { arrayBuffer: async () => new ArrayBuffer(1) };
  };
  assert.equal((await executeMode(f.manifest, f.api, f.directory, "apply")).status, "verified");
  assert.equal(f.api.objects.has(f.manifest.objects[0].source), false);
  const count = f.api.mutations.length;
  assert.equal((await executeMode(f.manifest, f.api, f.directory, "verify")).status, "verified");
  assert.equal((await executeMode(f.manifest, f.api, f.directory, "apply")).status, "verified");
  assert.equal(f.api.mutations.length, count);
  assert.equal((await executeMode(f.manifest, f.api, f.directory, "rollback")).status, "rolled-back");
  assert.equal((await executeMode(f.manifest, f.api, f.directory, "rollback")).status, "rolled-back");
  assert.deepEqual(probes.slice(0, 4), ["source/rep-a/video.mov", "destination/rep-a/video.mov", "destination/rep-a/video.mov", "destination/rep-a/video.mov"]);
  assert.equal(probes.at(-1), "source/rep-a/video.mov");
});

test("apply backs up bytes, prepares destination docs, atomically cuts over, cleans up, and resumes without mutations", async t => {
  const f = await fixture(t); const original = Buffer.from(f.api.objects.get("source/rep-a/video.mov").bytes);
  const result = await f.runner().apply(); assert.equal(result.status, "verified");
  assert.equal(f.api.docs.has("players/source/reps/rep-a"), false); assert.equal(f.api.objects.has("source/rep-a/video.mov"), false);
  assert.deepEqual(f.api.objects.get("destination/rep-a/video.mov").bytes, original);
  assert.equal(f.api.objects.get("destination/rep-a/context.json").bytes.toString(), JSON.stringify({ playerId: "destination", value: 12 }) + "\n");
  const journal = JSON.parse(await fs.readFile(path.join(f.directory, "journal.json"), "utf8"));
  assert.deepEqual(await fs.readFile(path.join(f.directory, journal.backups["source/rep-a/video.mov"].file)), original);
  const commits = f.api.mutations.filter(x => x.kind === "commit"); assert.equal(commits.length, 2);
  assert.ok(commits[0].writes.every(w => w.currentDocument.exists === false));
  assert.ok(commits[1].writes.some(w => w.delete === root + "players/source/reps/rep-a"));
  assert.ok(commits[1].writes.some(w => w.update?.name === root + f.manifest.markerPath));
  assert.ok(f.api.mutations.findIndex(x => x.kind === "delete") > f.api.mutations.findLastIndex(x => x.kind === "commit"));
  const count = f.api.mutations.length; await f.runner().apply(); assert.equal(f.api.mutations.length, count);
});

test("lost copy, upload, prepare, cutover and cleanup acknowledgements reconcile from verified readback", async t => {
  for (const mode of ["copy", "upload", "prepare", "cutover", "delete"]) {
    const f = await fixture(t);
    if (mode === "copy") f.api.loseCopy = true;
    if (mode === "upload") f.api.loseUpload = true;
    if (mode === "prepare") f.api.loseCommit = 1;
    if (mode === "cutover") f.api.loseCommit = 2;
    if (mode === "delete") f.api.loseDelete = true;
    assert.equal((await f.runner().apply()).status, "verified", mode);
    const count = f.api.mutations.length; await f.runner().apply(); assert.equal(f.api.mutations.length, count, mode);
  }
});

test("cleanup failure after marker commit resumes without repeating copies or document commits", async t => {
  const f = await fixture(t); f.api.failDelete = true;
  await assert.rejects(f.runner().apply(), /delete unavailable/); assert.ok(f.api.docs.has(f.manifest.markerPath));
  const commits = f.api.commits, copies = f.api.mutations.filter(x => x.kind === "copy").length;
  assert.equal((await f.runner().apply()).status, "verified"); assert.equal(f.api.commits, commits); assert.equal(f.api.mutations.filter(x => x.kind === "copy").length, copies);
});

test("review drift and preexisting destinations refuse before any remote mutation", async t => {
  for (const kind of ["document", "source", "destination"]) {
    const f = await fixture(t);
    if (kind === "document") f.api.docs.get("organizations/club").updateTime = "new-update";
    if (kind === "source") f.api.objects.get("source/rep-a/video.mov").meta.generation = "different";
    if (kind === "destination") f.api.putObject("destination/rep-a/video.mov", "existing");
    await assert.rejects(f.runner().apply()); assert.equal(f.api.mutations.length, 0);
  }
});

test("source download checksum failure stops before any remote mutation", async t => {
  const f = await fixture(t); f.api.corruptDownload = true;
  await assert.rejects(f.runner().apply(), /checksum/); assert.equal(f.api.mutations.length, 0);
});

test("concurrent cutover edit rejects the whole atomic commit and leaves original source docs/media intact", async t => {
  const f = await fixture(t);
  f.api.beforeCommit = async (api, writes) => { if (writes.some(w => w.update?.name === root + f.manifest.markerPath)) api.docs.get("organizations/club").updateTime = "concurrent"; };
  await assert.rejects(f.runner().apply(), /updateTime guard/);
  assert.ok(f.api.docs.has("players/source/reps/rep-a")); assert.ok(f.api.objects.has("source/rep-a/video.mov")); assert.equal(f.api.docs.has(f.manifest.markerPath), false);
});

test("rollback restores source bytes and document fields before removing repair-created destinations", async t => {
  const f = await fixture(t); const before = clone(f.manifest.documents);
  await f.runner().apply(); assert.equal((await f.runner().rollback()).status, "rolled-back");
  for (const d of before) assert.deepEqual((await f.api.getDoc(null, d.path))?.fields || null, d.before?.fields || null);
  for (const o of f.manifest.objects) { assert.equal(f.api.objects.has(o.destination), false); assert.equal(f.api.objects.get(o.source).meta.md5Hash, o.md5Hash); }
  assert.equal(f.api.docs.has(f.manifest.markerPath), false);
  const count = f.api.mutations.length; await f.runner().rollback(); assert.equal(f.api.mutations.length, count);
  await assert.rejects(f.runner().apply(), /rollback/);
});

test("rollback refuses changed document/object before restoring any bytes", async t => {
  for (const kind of ["document", "destination", "recreated-source"]) {
    const f = await fixture(t); await f.runner().apply();
    if (kind === "document") f.api.docs.get("organizations/club").updateTime = "later-user-edit";
    if (kind === "destination") f.api.objects.get("destination/rep-a/video.mov").meta.generation = "later-generation";
    if (kind === "recreated-source") f.api.putObject("source/rep-a/video.mov", "later-data", "100000");
    const count = f.api.mutations.length; await assert.rejects(f.runner().rollback()); assert.equal(f.api.mutations.length, count, kind);
  }
});

test("in-place JSON rewrite requires explicit guard, preserves original backup, and rolls back by output generation", async t => {
  const f = await fixture(t, { inPlace: true }); const name = "failure_cases/report-a/report.json", original = Buffer.from(f.api.objects.get(name).bytes);
  await f.runner().apply(); assert.equal(f.api.objects.get(name).bytes.toString(), '{"playerId":"destination"}\n');
  const count = f.api.mutations.length; await f.runner().apply(); assert.equal(f.api.mutations.length, count);
  await f.runner().rollback(); assert.deepEqual(f.api.objects.get(name).bytes, original);
  assert.equal(f.api.objects.get(name).meta.metadata.preserved, "yes");
  assert.ok(f.api.mutations.filter(x => x.kind === "upload" && x.destination === name).every(x => x.generation !== "0"));
});

test("rollback acknowledges lost restoring upload and atomic document response", async t => {
  const f = await fixture(t, { inPlace: true }); await f.runner().apply();
  f.api.loseUpload = true; f.api.loseCommit = 3;
  assert.equal((await f.runner().rollback()).status, "rolled-back");
});

test("rollback resumes a crash after restored bytes were uploaded but before their new generation was journaled", async t => {
  for (const name of ["source/rep-a/video.mov", "failure_cases/report-a/report.json"]) {
    const f = await fixture(t, { inPlace: true }); await f.runner().apply();
    const runner = f.runner(), originalSave = runner.save; let crashed = false;
    runner.save = async function () {
      if (this.j.restoredObjects[name]?.generation && !crashed) { crashed = true; throw Error("simulated process crash before journal save"); }
      return originalSave.call(this);
    };
    await assert.rejects(runner.rollback(), /simulated process crash/);
    const disk = JSON.parse(await fs.readFile(path.join(f.directory, "journal.json"), "utf8"));
    assert.equal(disk.restoredObjects[name].intent, true); assert.equal(disk.restoredObjects[name].generation, undefined);
    assert.equal((await f.runner().rollback()).status, "rolled-back", name);
  }
});

test("rollback of a failed first copy does not require a destination that was never created", async t => {
  const f = await fixture(t); f.api.copy = async () => { throw Error("copy rejected before mutation"); };
  await assert.rejects(f.runner().apply(), /copy rejected/);
  assert.equal((await f.runner().rollback()).status, "rolled-back"); assert.equal(f.api.mutations.length, 0);
});

test("rollback restores prepared docs and successful copies after a pre-cutover failure", async t => {
  const f = await fixture(t); f.api.beforeCommit = async (_api, writes) => { if (writes.some(w => w.update?.name === root + f.manifest.markerPath)) throw Error("cutover unavailable"); };
  await assert.rejects(f.runner().apply(), /cutover unavailable/);
  f.api.beforeCommit = null;
  assert.equal((await f.runner().rollback()).status, "rolled-back");
  assert.equal(f.api.docs.has("players/destination/reps/rep-a"), false); assert.ok(f.api.docs.has("players/source/reps/rep-a"));
});

test("manifest hash, duplicate paths, source overlap, phase shape and changed journal are rejected", async t => {
  const f = await fixture(t); assert.equal(validateManifest(f.manifest), hash(f.manifest));
  for (const change of [
    m => m.documents.push(clone(m.documents[0])),
    m => { m.documents[0].phase = "prepare"; m.documents[0].before = m.documents[1].before; },
    m => { m.objects[0].destination = m.objects[1].source; },
    m => { m.objects[0].source = "../outside"; },
    m => { m.objects[0].replaceExisting = true; },
  ]) { const m = clone(f.manifest); change(m); assert.throws(() => validateManifest(m)); }
  await f.runner().apply(); const altered = clone(f.manifest); altered.documents[2].afterFields = fields("different");
  await assert.rejects(new RepairRunner(altered, f.api, f.directory).apply(), /different manifest/);
});
