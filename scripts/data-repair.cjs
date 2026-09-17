#!/usr/bin/env node
"use strict";

// Explicit, private, manifest-bound data repair. No credentials or athlete data
// belong in this source. CLI: --manifest PATH --run-dir IGNORED_PRIVATE_DIR
// --mode dry-run|apply|verify|rollback. Required manifest shape:
// {version:1,id,project,bucket,markerPath,documents,objects,cleanupObjects}.
// Documents: {path,before:fullRawRestDocument|null,afterFields:fullRawFields|null,
//             phase?:"prepare"|"cutover"}. afterFields is a full replacement.
// Objects: {source,destination,generation,md5Hash,afterJson?,replaceExisting?}.
// replaceExisting:true is allowed only for source===destination with afterJson.
// Cleanup: {name,generation,md5Hash}. JSON output is compact JSON plus newline.
// Backups/journals may contain private Storage metadata and athlete records;
// OAuth credentials remain only in memory. Rollback restores stored document
// fields, but Firestore cannot preserve system createTime on recreated deletes.
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { execFileSync } = require("node:child_process");

class RepairError extends Error {}
const fail = message => { throw new RepairError(message); };
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
const hash = value => crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonical(value)).digest("hex");
const equal = (a, b) => canonical(a) === canonical(b);
const timestamp = () => new Date().toISOString();
const objectMap = () => Object.create(null);
const safePath = p => typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some(x => !x || x === "." || x === "..");
const docName = (manifest, p) => `projects/${manifest.project}/databases/(default)/documents/${p}`;
const exists = async file => { try { await fs.access(file); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };

function validateManifest(m) {
  if (m?.version !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(m.id || "") || !/^[a-z][a-z0-9-]{4,62}$/.test(m.project || "")
    || !/^[a-z0-9][a-z0-9._-]+$/.test(m.bucket || "")) fail("Invalid manifest identity.");
  if (!Array.isArray(m.documents) || !Array.isArray(m.objects) || !Array.isArray(m.cleanupObjects)) fail("Manifest lists are required.");
  if (!safePath(m.markerPath) || m.markerPath.split("/").length % 2) fail("Invalid marker document path.");
  const names = new Set([m.markerPath]);
  for (const d of m.documents) {
    if (!safePath(d.path) || d.path.split("/").length % 2 || names.has(d.path)) fail("Invalid or duplicate document path.");
    names.add(d.path);
    if (d.before !== null && (!d.before?.updateTime || d.before.name !== docName(m, d.path) || typeof d.before.fields !== "object")) fail("Document before-image must contain its full name, fields and updateTime.");
    if (d.afterFields !== null && (!d.afterFields || typeof d.afterFields !== "object" || Array.isArray(d.afterFields))) fail("afterFields must be raw Firestore fields or null.");
    if (d.before === null && d.afterFields === null) fail("Cannot delete a nonexistent document.");
    if (d.phase !== undefined && !["prepare", "cutover"].includes(d.phase)) fail("Unknown document phase.");
    if (d.phase === "prepare" && (d.before !== null || d.afterFields === null)) fail("Prepare documents must be create-only.");
  }
  if (m.documents.length + 1 > 500) fail("Repair exceeds the bounded atomic document limit.");
  for (const phase of ["prepare", "cutover"]) {
    const writes = m.documents.filter(d => (d.phase || "cutover") === phase).map(d => documentWrite(m, d));
    if (Buffer.byteLength(JSON.stringify({ writes })) > 9 * 1024 * 1024 - 2048) fail("Manifest exceeds the bounded atomic request size.");
  }
  const sources = new Map(), destinations = new Set(), cleanup = new Set();
  for (const o of [...m.objects.map(o => ({ ...o, name: o.source })), ...m.cleanupObjects]) {
    if (!safePath(o.name) || !/^\d+$/.test(String(o.generation || "")) || typeof o.md5Hash !== "string" || !o.md5Hash) fail("Every source requires a valid name, generation and MD5.");
    if (sources.has(o.name) && !equal(sources.get(o.name), { generation: String(o.generation), md5Hash: o.md5Hash })) fail("Conflicting source generations.");
    sources.set(o.name, { generation: String(o.generation), md5Hash: o.md5Hash });
  }
  for (const o of m.objects) {
    const inPlace = o.replaceExisting === true && o.source === o.destination && Object.hasOwn(o, "afterJson");
    if (o.replaceExisting !== undefined && !inPlace) fail("replaceExisting requires an in-place afterJson rewrite.");
    if (!safePath(o.destination) || (sources.has(o.destination) && !inPlace) || destinations.has(o.destination)) fail("Destinations must be unique and disjoint from every source except explicit in-place rewrites.");
    destinations.add(o.destination);
    if (Object.hasOwn(o, "afterJson") && o.afterJson === undefined) fail("afterJson must be JSON-serializable.");
  }
  for (const o of m.cleanupObjects) { if (cleanup.has(o.name) || m.objects.some(x => x.replaceExisting && x.destination === o.name)) fail("Duplicate cleanup or cleanup of an in-place rewrite."); cleanup.add(o.name); }
  const serialized = canonical(m);
  if (serialized.includes(":undefined") || serialized.includes("[undefined")) fail("Manifest contains undefined values.");
  return hash(serialized);
}

function documentWrite(m, d, before = d.before, after = d.afterFields) {
  const currentDocument = before ? { updateTime: before.updateTime } : { exists: false };
  return after === null ? { delete: docName(m, d.path), currentDocument }
    : { update: { name: docName(m, d.path), fields: after }, currentDocument };
}
function comparableFirestoreFields(fields) {
  // REST omits empty protobuf map/array members on readback. Normalize ONLY
  // these typed container representations for comparison; never rewrite the
  // manifest, before-images, write bodies, or their canonical hashes.
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return fields;
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, comparableFirestoreValue(value)]));
}
function comparableFirestoreValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (Object.hasOwn(value, "mapValue") && value.mapValue && typeof value.mapValue === "object" && !Array.isArray(value.mapValue)) {
    const map = value.mapValue;
    return { ...value, mapValue: { ...map, fields: Object.hasOwn(map, "fields") ? comparableFirestoreFields(map.fields) : {} } };
  }
  if (Object.hasOwn(value, "arrayValue") && value.arrayValue && typeof value.arrayValue === "object" && !Array.isArray(value.arrayValue)) {
    const array = value.arrayValue;
    return { ...value, arrayValue: { ...array, values: Object.hasOwn(array, "values")
      ? (Array.isArray(array.values) ? array.values.map(comparableFirestoreValue) : array.values) : [] } };
  }
  return value;
}
const firestoreFieldsEqual = (a, b) => equal(comparableFirestoreFields(a), comparableFirestoreFields(b));
function assertBefore(expected, actual) {
  if (expected === null ? actual !== null : !actual || actual.updateTime !== expected.updateTime || !firestoreFieldsEqual(actual.fields || {}, expected.fields || {})) fail("Document changed after manifest review; no cutover was sent.");
}
function assertFields(expected, actual) {
  if (expected === null ? actual !== null : !actual || !firestoreFieldsEqual(expected, actual.fields || {})) fail("Document readback differs from the manifest.");
}
function assertGeneration(expected, actual) {
  if (!actual || String(actual.generation) !== String(expected.generation) || actual.md5Hash !== expected.md5Hash) fail("Source object generation or checksum changed.");
}

async function digestFile(file) {
  const sha = crypto.createHash("sha256"), md5 = crypto.createHash("md5"); let bytes = 0;
  for await (const chunk of fss.createReadStream(file)) { sha.update(chunk); md5.update(chunk); bytes += chunk.length; }
  return { sha256: sha.digest("hex"), md5Hash: md5.digest("base64"), bytes };
}
async function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await fs.rename(temporary, file);
}

class GoogleApi {
  constructor(token) { this.token = token; }
  async request(url, { method = "GET", body, headers = {}, missing = false, raw = false } = {}) {
    const response = await fetch(url, { method, body, headers: { Authorization: `Bearer ${this.token}`, ...headers },
      ...(body && typeof body.pipe === "function" ? { duplex: "half" } : {}), signal: AbortSignal.timeout(180000) });
    if (missing && response.status === 404) return null;
    if (!response.ok) fail(`Google API request failed (HTTP ${response.status}); no response body was logged.`);
    if (raw) return response;
    return response.status === 204 ? null : response.json();
  }
  async authorize(m, { journal = null, mode = "apply" } = {}) {
    const required = ["datastore.entities.get", "datastore.entities.create", "datastore.entities.update", "datastore.entities.delete"];
    const permissions = await this.request(`https://cloudresourcemanager.googleapis.com/v1/projects/${m.project}:testIamPermissions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permissions: required }) });
    if (!required.every(p => permissions.permissions?.includes(p))) fail("Google login lacks the required project data permissions.");
    // Bucket permission tests do not establish per-object ACL read access.
    // Keep the mutation gate, then prove scoped reads against an actual source.
    // Before the first mutation backup() downloads/checksums EVERY source.
    const storage = ["storage.objects.create", "storage.objects.delete"];
    const query = new URLSearchParams(storage.map(p => ["permissions", p]));
    const result = await this.request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(m.bucket)}/iam/testPermissions?${query}`);
    if (!storage.every(p => result.permissions?.includes(p))) fail("Google login lacks the required bucket data permissions.");
    const sources = new Map([...m.objects.map(o => [o.source, { name: o.source, generation: o.generation, md5Hash: o.md5Hash }]), ...m.cleanupObjects.map(o => [o.name, o])]);
    const candidates = [], manifestHash = validateManifest(m);
    if (journal) {
      if (journal.manifestHash !== manifestHash || journal.id !== m.id) fail("Authorization journal belongs to another manifest.");
      // After cleanup the original source may not exist. A restored original
      // or a journal-owned destination is then the scoped read probe.
      for (const source of sources.values()) {
        const restored = journal.restoredObjects?.[source.name];
        if (restored?.generation && restored.md5Hash === source.md5Hash) candidates.push({ ...source, generation: restored.generation });
      }
      for (const o of m.objects) {
        const destination = journal.destinations?.[o.destination];
        const expectedMd5 = Object.hasOwn(o, "afterJson") ? crypto.createHash("md5").update(JSON.stringify(o.afterJson) + "\n").digest("base64") : o.md5Hash;
        if (destination?.generation && destination.md5Hash === expectedMd5) candidates.push({ name: o.destination, generation: destination.generation, md5Hash: expectedMd5, repairOwned: true });
      }
    }
    candidates.push(...sources.values());
    if (!candidates.length) return;
    let foundExisting = false;
    for (const candidate of candidates) {
      const meta = await this.meta(m, candidate.name); if (!meta) continue;
      foundExisting = true;
      if (String(meta.generation) !== String(candidate.generation) || meta.md5Hash !== candidate.md5Hash) continue;
      if (candidate.repairOwned && (meta.metadata?.posetekRepairManifestHash !== manifestHash || meta.metadata?.posetekRepairId !== m.id)) continue;
      const response = await this.request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(m.bucket)}/o/${encodeURIComponent(candidate.name)}?alt=media&generation=${candidate.generation}`, {
        raw: true, headers: Number(meta.size) > 0 ? { Range: "bytes=0-0" } : {} });
      await response.arrayBuffer(); return;
    }
    // A cleanup-only repair can have no surviving remote object. Its journal
    // and local checksummed backups are required before any restore upload.
    if (!foundExisting && journal && mode !== "dry-run" && m.objects.length === 0
      && m.cleanupObjects.every(o => journal.cleanup?.[o.name]?.deleted === true)) return;
    fail("No unchanged manifest-scoped object is available to prove read access.");
  }
  getDoc(m, p) { return this.request(`https://firestore.googleapis.com/v1/${docName(m, p)}`, { missing: true }); }
  commit(m, writes) {
    const body = JSON.stringify({ writes });
    if (Buffer.byteLength(body) > 9 * 1024 * 1024) fail("Atomic document request exceeds 9 MiB.");
    return this.request(`https://firestore.googleapis.com/v1/projects/${m.project}/databases/(default)/documents:commit`, { method: "POST", body, headers: { "Content-Type": "application/json" } });
  }
  meta(m, name) { return this.request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(m.bucket)}/o/${encodeURIComponent(name)}`, { missing: true }); }
  async download(m, name, generation, file) {
    const response = await this.request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(m.bucket)}/o/${encodeURIComponent(name)}?alt=media&generation=${generation}`, { raw: true });
    await pipeline(Readable.fromWeb(response.body), fss.createWriteStream(file, { flags: "wx", mode: 0o600 }));
  }
  async copy(m, source, destination, generation, metadata) {
    let rewriteToken;
    do {
      const query = new URLSearchParams({ ifSourceGenerationMatch: String(generation), ifGenerationMatch: "0", ...(rewriteToken ? { rewriteToken } : {}) });
      const result = await this.request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(m.bucket)}/o/${encodeURIComponent(source)}/rewriteTo/b/${encodeURIComponent(m.bucket)}/o/${encodeURIComponent(destination)}?${query}`, {
        method: "POST", body: JSON.stringify(metadata), headers: { "Content-Type": "application/json" } });
      if (result.done) return result.resource;
      if (!result.rewriteToken || result.rewriteToken === rewriteToken) fail("Storage rewrite made no progress.");
      rewriteToken = result.rewriteToken;
    } while (rewriteToken);
  }
  async upload(m, destination, file, metadata, generation = "0") {
    const boundary = `repair_${crypto.randomUUID()}`;
    const prefix = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ ...metadata, name: destination })}\r\n--${boundary}\r\nContent-Type: ${metadata.contentType || "application/octet-stream"}\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const size = (await fs.stat(file)).size;
    const body = Readable.from((async function* () { yield prefix; yield* fss.createReadStream(file); yield suffix; })());
    return this.request(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(m.bucket)}/o?uploadType=multipart&ifGenerationMatch=${generation}`, {
      method: "POST", body, headers: { "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": String(prefix.length + size + suffix.length) } });
  }
  deleteObject(m, name, generation) {
    return this.request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(m.bucket)}/o/${encodeURIComponent(name)}?ifGenerationMatch=${generation}`, { method: "DELETE" });
  }
}

function writableMetadata(metadata) {
  return Object.fromEntries(["contentType", "cacheControl", "contentDisposition", "contentEncoding", "contentLanguage", "metadata"].filter(k => metadata[k] !== undefined).map(k => [k, metadata[k]]));
}

class RepairRunner {
  constructor(manifest, api, runDir) {
    this.m = manifest; this.manifestHash = validateManifest(manifest); this.api = api; this.dir = path.resolve(runDir);
    this.journalFile = path.join(this.dir, "journal.json"); this.j = null;
  }
  async save() { this.j.updatedAt = timestamp(); await atomicJson(this.journalFile, this.j); }
  async init(create = false) {
    if (await exists(this.journalFile)) {
      this.j = JSON.parse(await fs.readFile(this.journalFile, "utf8"));
      if (this.j.manifestHash !== this.manifestHash || this.j.id !== this.m.id) fail("Run directory belongs to a different manifest.");
    } else if (create) {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.mkdir(path.join(this.dir, "bytes"), { recursive: true });
      await fs.mkdir(path.join(this.dir, "outputs"), { recursive: true });
      await fs.writeFile(path.join(this.dir, "manifest.json"), JSON.stringify(this.m, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      this.j = { version: 1, id: this.m.id, manifestHash: this.manifestHash, status: "initial", createdAt: timestamp(), backups: objectMap(), destinations: objectMap(), documents: objectMap(), cleanup: objectMap(), restoredObjects: objectMap(), rollbackDeleted: objectMap() };
      await this.save();
    } else fail("A matching private journal is required for verification or rollback.");
  }
  async marker() {
    const marker = await this.api.getDoc(this.m, this.m.markerPath);
    if (marker && (marker.fields?.manifestHash?.stringValue !== this.manifestHash || marker.fields?.repairId?.stringValue !== this.m.id)) fail("A different repair owns the migration marker.");
    return marker;
  }
  sources() { return new Map([...this.m.objects.map(o => [o.source, { name: o.source, generation: o.generation, md5Hash: o.md5Hash }]), ...this.m.cleanupObjects.map(o => [o.name, o])]); }
  async dryRun() {
    if (await this.marker()) fail("Repair is already committed; use verify with its original run directory.");
    for (const d of this.m.documents) assertBefore(d.before, await this.api.getDoc(this.m, d.path));
    let sourceBytes = 0;
    for (const o of this.sources().values()) { const meta = await this.api.meta(this.m, o.name); assertGeneration(o, meta); sourceBytes += Number(meta.size || 0); }
    for (const o of this.m.objects) if (!o.replaceExisting && await this.api.meta(this.m, o.destination)) fail("A destination object already exists.");
    return { status: "dry-run-verified", manifestHash: this.manifestHash, documents: this.m.documents.length, copies: this.m.objects.length, cleanup: this.m.cleanupObjects.length, sourceBytes };
  }
  async backup() {
    for (const o of this.sources().values()) {
      const key = hash(o.name), relative = `bytes/${key}.bin`, file = path.join(this.dir, relative);
      const saved = this.j.backups[o.name];
      if (saved) { const digest = await digestFile(file); if (digest.sha256 !== saved.sha256 || digest.md5Hash !== o.md5Hash) fail("A private object backup changed."); continue; }
      const metadata = await this.api.meta(this.m, o.name); assertGeneration(o, metadata);
      if (await exists(file)) { if ((await digestFile(file)).md5Hash !== o.md5Hash) fail("An unfinished backup differs from its source."); }
      else {
        const temporary = `${file}.${crypto.randomUUID()}.partial`;
        await this.api.download(this.m, o.name, o.generation, temporary);
        if ((await digestFile(temporary)).md5Hash !== o.md5Hash) fail("Downloaded backup checksum differs from the source.");
        await fs.rename(temporary, file);
      }
      const digest = await digestFile(file);
      this.j.backups[o.name] = { file: relative, metadata, ...digest }; await this.save();
    }
    this.j.status = "backed-up"; await this.save();
  }
  async output(o) {
    const backup = this.j.backups[o.source];
    if (!backup) fail("Source backup is missing.");
    if (!Object.hasOwn(o, "afterJson")) return { ...backup, file: path.join(this.dir, backup.file) };
    const bytes = Buffer.from(JSON.stringify(o.afterJson) + "\n");
    const file = path.join(this.dir, "outputs", `${hash(o.destination)}.json`);
    if (await exists(file)) { if ((await digestFile(file)).sha256 !== hash(bytes)) fail("Transformed output changed."); }
    else await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    return { file, sha256: hash(bytes), md5Hash: crypto.createHash("md5").update(bytes).digest("base64"), bytes: bytes.length };
  }
  async verifyObject(name, metadata, expectedHash) {
    const temporary = path.join(this.dir, "outputs", `${crypto.randomUUID()}.verify`);
    try { await this.api.download(this.m, name, metadata.generation, temporary); if ((await digestFile(temporary)).sha256 !== expectedHash) fail("Destination bytes differ from the verified output."); }
    finally { await fs.unlink(temporary).catch(() => {}); }
  }
  async copied(o, { required = false } = {}) {
    const record = this.j.destinations[o.destination], meta = await this.api.meta(this.m, o.destination);
    if (!meta) { if (required || record?.generation) fail("A copied object disappeared after repair."); return false; }
    if (o.replaceExisting && !required && !record?.generation && String(meta.generation) === String(o.generation) && meta.md5Hash === o.md5Hash) return false;
    if (!record?.intent || meta.metadata?.posetekRepairManifestHash !== this.manifestHash || meta.metadata?.posetekRepairId !== this.m.id) fail("Destination exists without this repair's ownership evidence.");
    if (record.generation && String(meta.generation) !== String(record.generation)) fail("Destination changed after repair.");
    const expected = await this.output(o);
    if (meta.md5Hash !== expected.md5Hash) fail("Destination checksum differs from expected output.");
    await this.verifyObject(o.destination, meta, expected.sha256);
    if (!record.generation) { Object.assign(record, { generation: meta.generation, sha256: expected.sha256, md5Hash: expected.md5Hash, bytes: expected.bytes }); await this.save(); }
    return true;
  }
  async copyObjects(committed) {
    for (const o of this.m.objects) {
      if (await this.copied(o, { required: committed })) continue;
      assertGeneration(o, await this.api.meta(this.m, o.source));
      const output = await this.output(o), sourceMetadata = this.j.backups[o.source].metadata;
      const metadata = { ...writableMetadata(sourceMetadata), ...(Object.hasOwn(o, "afterJson") ? { contentType: "application/json", contentEncoding: undefined } : {}),
        metadata: { ...(sourceMetadata.metadata || {}), posetekRepairId: this.m.id, posetekRepairManifestHash: this.manifestHash } };
      this.j.destinations[o.destination] = { intent: true, sha256: output.sha256 }; await this.save();
      try {
        if (Object.hasOwn(o, "afterJson")) await this.api.upload(this.m, o.destination, output.file, metadata, o.replaceExisting ? o.generation : "0");
        else await this.api.copy(this.m, o.source, o.destination, o.generation, metadata);
      } catch (error) { if (!await this.copied(o)) throw error; }
      await this.copied(o, { required: true });
    }
  }
  async recordDocuments(list) {
    for (const d of list) {
      const actual = await this.api.getDoc(this.m, d.path); assertFields(d.afterFields, actual);
      const saved = this.j.documents[d.path];
      if (saved && saved.updateTime !== (actual?.updateTime || null)) fail("A repaired document changed after its verified readback.");
      if (!saved) this.j.documents[d.path] = { updateTime: actual?.updateTime || null, fieldsHash: hash(d.afterFields), phase: d.phase || "cutover" };
    }
    await this.save();
  }
  async prepareDocuments() {
    const list = this.m.documents.filter(d => d.phase === "prepare"); if (!list.length) return;
    if (this.j.prepareIntent) {
      const current = await Promise.all(list.map(d => this.api.getDoc(this.m, d.path)));
      if (current.every((doc, i) => doc && firestoreFieldsEqual(doc.fields || {}, list[i].afterFields))) { await this.recordDocuments(list); return; }
      if (current.some(Boolean)) fail("Prepare commit has conflicting or partial readback.");
    }
    for (const d of list) assertBefore(null, await this.api.getDoc(this.m, d.path));
    this.j.prepareIntent = true; this.j.status = "prepare-pending"; await this.save();
    try { await this.api.commit(this.m, list.map(d => documentWrite(this.m, d))); }
    catch (error) { try { await this.recordDocuments(list); } catch { throw error; } }
    await this.recordDocuments(list);
  }
  async cutover() {
    let marker = await this.marker();
    const list = this.m.documents.filter(d => d.phase !== "prepare");
    if (!marker) {
      for (const d of list) assertBefore(d.before, await this.api.getDoc(this.m, d.path));
      await this.recordDocuments(this.m.documents.filter(d => d.phase === "prepare"));
      const markerDoc = { path: this.m.markerPath, before: null, afterFields: { repairId: { stringValue: this.m.id }, manifestHash: { stringValue: this.manifestHash }, status: { stringValue: "committed" } } };
      this.j.status = "cutover-pending"; await this.save();
      try { await this.api.commit(this.m, [...list.map(d => documentWrite(this.m, d)), documentWrite(this.m, markerDoc)]); }
      catch (error) { marker = await this.marker(); if (!marker) throw error; }
      marker = await this.marker(); if (!marker) fail("Cutover acknowledgement lacks its atomic marker.");
    }
    if (this.j.markerUpdateTime && this.j.markerUpdateTime !== marker.updateTime) fail("Migration marker changed after repair.");
    this.j.markerUpdateTime = marker.updateTime;
    await this.recordDocuments(this.m.documents);
    this.j.status = "cutover-verified"; await this.save();
  }
  async cleanup() {
    for (const o of this.m.cleanupObjects) {
      const actual = await this.api.meta(this.m, o.name), saved = this.j.cleanup[o.name];
      if (!actual) { if (!saved?.intent) fail("Cleanup source disappeared without a recorded deletion intent."); this.j.cleanup[o.name].deleted = true; await this.save(); continue; }
      if (saved?.deleted) fail("A deleted source object was recreated after repair.");
      assertGeneration(o, actual);
      this.j.cleanup[o.name] = { intent: true }; await this.save();
      try { await this.api.deleteObject(this.m, o.name, o.generation); }
      catch (error) { if (await this.api.meta(this.m, o.name)) throw error; }
      if (await this.api.meta(this.m, o.name)) fail("Cleanup object remains after delete.");
      this.j.cleanup[o.name].deleted = true; await this.save();
    }
  }
  async verify() {
    const marker = await this.marker(); if (!marker || marker.updateTime !== this.j.markerUpdateTime) fail("Verified migration marker is missing or changed.");
    await this.recordDocuments(this.m.documents);
    for (const o of this.m.objects) await this.copied(o, { required: true });
    for (const o of this.m.cleanupObjects) if (await this.api.meta(this.m, o.name)) fail("A source scheduled for cleanup still exists.");
    this.j.status = "verified"; await this.save();
    return { status: "verified", manifestHash: this.manifestHash, documents: this.m.documents.length, copiedObjects: this.m.objects.length, deletedObjects: this.m.cleanupObjects.length };
  }
  async apply() {
    await this.init(true);
    if (this.j.status.startsWith("rollback") || this.j.status === "rolled-back") fail("This run has entered rollback and cannot be reapplied.");
    if (this.j.status === "initial") { await this.dryRun(); await this.backup(); }
    else await this.backup();
    const committed = Boolean(await this.marker());
    await this.copyObjects(committed);
    if (!committed) await this.prepareDocuments();
    await this.cutover(); await this.cleanup(); return this.verify();
  }
  async rollback() {
    await this.init();
    const restoreSources = [...this.m.cleanupObjects, ...this.m.objects.filter(o => o.replaceExisting).map(o => ({ name: o.source, generation: o.generation, md5Hash: o.md5Hash, inPlace: true }))];
    // An upload can finish before its response/generation is journaled. Only
    // an existing restore intent plus exact original bytes AND writable
    // metadata may resolve that uncertainty; never adopt merely equal names.
    for (const o of restoreSources) {
      const restore = this.j.restoredObjects[o.name];
      if (!restore?.intent || restore.generation) continue;
      const actual = await this.api.meta(this.m, o.name), saved = this.j.backups[o.name];
      if (actual && saved && actual.md5Hash === o.md5Hash && equal(writableMetadata(actual), writableMetadata(saved.metadata))) {
        await this.verifyObject(o.name, actual, saved.sha256);
        this.j.restoredObjects[o.name] = { intent: true, generation: actual.generation, md5Hash: actual.md5Hash }; await this.save();
      }
    }
    const changed = this.m.documents.filter(d => this.j.documents[d.path]);
    if (this.j.status === "rollback-documents-pending" && !await this.marker()) {
      await this.verifyOriginalDocuments(changed); this.j.rollbackDocsDone = true; await this.save();
    }
    // Resolve only writes carrying the original intent; never adopt unrelated state.
    if (await this.marker()) await this.cutover();
    else if (this.j.prepareIntent && !this.j.rollbackDocsDone) await this.prepareReadbackForRollback();
    const modified = this.m.documents.filter(d => this.j.documents[d.path]);
    if (!this.j.rollbackDocsDone) {
      // Entire preflight completes before restoring any bytes or documents.
      for (const d of modified) { const actual = await this.api.getDoc(this.m, d.path); assertFields(d.afterFields, actual); if ((actual?.updateTime || null) !== this.j.documents[d.path].updateTime) fail("Rollback refused: document changed after repair."); }
      for (const o of this.m.objects) {
        const record = this.j.destinations[o.destination];
        if (!record?.intent || this.j.restoredObjects[o.destination]?.generation) continue;
        const actual = await this.api.meta(this.m, o.destination);
        if (!record.generation && (!actual || (o.replaceExisting && String(actual.generation) === String(o.generation) && actual.md5Hash === o.md5Hash))) continue;
        await this.copied(o, { required: true });
      }
      for (const o of restoreSources) {
        const actual = await this.api.meta(this.m, o.name), restored = this.j.restoredObjects[o.name];
        if (restored?.generation) assertGeneration(restored, actual);
        else if (actual && o.inPlace && this.j.destinations[o.name]?.generation) assertGeneration(this.j.destinations[o.name], actual);
        else if (actual) assertGeneration(o, actual);
        else if (!this.j.cleanup[o.name]?.intent) fail("Rollback source vanished without a cleanup intent.");
        const saved = this.j.backups[o.name];
        if (!saved || (await digestFile(path.join(this.dir, saved.file))).sha256 !== saved.sha256) fail("Rollback backup is missing or corrupt.");
      }
      this.j.status = "rollback-restoring"; await this.save();
      for (const o of restoreSources) {
        const current = await this.api.meta(this.m, o.name);
        if (this.j.restoredObjects[o.name]?.generation || (current && (!o.inPlace || String(current.generation) === String(o.generation)))) continue;
        const saved = this.j.backups[o.name]; this.j.restoredObjects[o.name] = { intent: true }; await this.save();
        try { await this.api.upload(this.m, o.name, path.join(this.dir, saved.file), writableMetadata(saved.metadata), o.inPlace ? this.j.destinations[o.name].generation : "0"); }
        catch (error) { const actual = await this.api.meta(this.m, o.name); if (!actual || actual.md5Hash !== o.md5Hash) throw error; }
        const actual = await this.api.meta(this.m, o.name);
        if (!actual || actual.md5Hash !== o.md5Hash) fail("Restored source checksum differs.");
        await this.verifyObject(o.name, actual, saved.sha256);
        this.j.restoredObjects[o.name] = { intent: true, generation: actual.generation, md5Hash: actual.md5Hash }; await this.save();
      }
      const writes = modified.map(d => documentWrite(this.m, d, this.j.documents[d.path].updateTime ? { updateTime: this.j.documents[d.path].updateTime } : null, d.before?.fields || null));
      const marker = await this.marker(); if (marker) writes.push({ delete: docName(this.m, this.m.markerPath), currentDocument: { updateTime: marker.updateTime } });
      this.j.status = "rollback-documents-pending"; await this.save();
      if (writes.length) {
        try { await this.api.commit(this.m, writes); }
        catch (error) { try { await this.verifyOriginalDocuments(modified); } catch { throw error; } }
      }
      await this.verifyOriginalDocuments(modified); this.j.rollbackDocsDone = true; await this.save();
    }
    for (const o of this.m.objects) {
      if (o.replaceExisting) continue;
      const saved = this.j.destinations[o.destination]; if (!saved?.intent) continue;
      const actual = await this.api.meta(this.m, o.destination);
      if (!actual) { if (saved.generation && !this.j.rollbackDeleted[o.destination]) fail("Rollback destination disappeared without a deletion intent."); continue; }
      await this.copied(o, { required: true }); this.j.rollbackDeleted[o.destination] = true; await this.save();
      try { await this.api.deleteObject(this.m, o.destination, saved.generation); }
      catch (error) { if (await this.api.meta(this.m, o.destination)) throw error; }
      if (await this.api.meta(this.m, o.destination)) fail("Rollback destination remains after deletion.");
    }
    await this.verifyOriginalDocuments(modified);
    for (const o of restoreSources) {
      const actual = await this.api.meta(this.m, o.name), restored = this.j.restoredObjects[o.name];
      assertGeneration(restored?.generation ? restored : o, actual);
    }
    this.j.status = "rolled-back"; await this.save(); return { status: "rolled-back", manifestHash: this.manifestHash };
  }
  async prepareReadbackForRollback() {
    for (const d of this.m.documents.filter(d => d.phase === "prepare")) {
      const actual = await this.api.getDoc(this.m, d.path);
      if (actual) { assertFields(d.afterFields, actual); if (!this.j.documents[d.path]) this.j.documents[d.path] = { updateTime: actual.updateTime, fieldsHash: hash(d.afterFields), phase: "prepare" }; }
      else if (this.j.documents[d.path]) fail("Prepared document disappeared before rollback.");
    }
    await this.save();
  }
  async verifyOriginalDocuments(list) {
    for (const d of list) assertFields(d.before?.fields || null, await this.api.getDoc(this.m, d.path));
    if (await this.marker()) fail("Migration marker remains after rollback.");
  }
}

async function cliToken(root) {
  const cliRoot = process.env.FIREBASE_TOOLS_ROOT || path.join(process.env.APPDATA || "", "npm/node_modules/firebase-tools");
  const auth = require(path.join(cliRoot, "lib/auth.js"));
  const account = auth.getProjectDefaultAccount(root);
  if (!account?.tokens?.refresh_token) fail("An existing Firebase CLI Google login is required.");
  if (account.tokens.access_token && Number(account.tokens.expires_at) > Date.now() + 60000) return account.tokens.access_token;
  const result = await auth.getAccessToken(account.tokens.refresh_token, ["https://www.googleapis.com/auth/cloud-platform"]);
  if (!result?.access_token || result.access_token === account.tokens.refresh_token) fail("Firebase CLI Google login must be renewed.");
  return result.access_token;
}
async function executeMode(manifest, api, runDir, mode) {
  if (!["dry-run", "apply", "verify", "rollback"].includes(mode)) fail("Unknown repair mode.");
  const runner = new RepairRunner(manifest, api, runDir);
  if (await exists(runner.journalFile) || mode === "verify" || mode === "rollback") await runner.init();
  await api.authorize(manifest, { journal: runner.j, mode });
  return mode === "dry-run" ? runner.dryRun() : runner[mode]();
}
async function main(argv = process.argv.slice(2)) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) { if (!["--manifest", "--run-dir", "--mode"].includes(argv[i]) || !argv[i + 1] || flags[argv[i]]) fail("Use --manifest PATH --run-dir IGNORED_PRIVATE_DIR --mode dry-run|apply|verify|rollback."); flags[argv[i]] = argv[i + 1]; }
  if (!flags["--manifest"] || !flags["--run-dir"] || !["dry-run", "apply", "verify", "rollback"].includes(flags["--mode"])) fail("All three CLI arguments are required.");
  const root = path.resolve(__dirname, ".."), runDir = path.resolve(flags["--run-dir"]), relative = path.relative(root, runDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("Run directory must be an ignored private folder within this repository.");
  try { execFileSync("git", ["check-ignore", "--quiet", "--", path.join(relative, "journal.json")], { cwd: root, stdio: "ignore" }); }
  catch { fail("Run directory must be ignored by Git."); }
  let ancestor = runDir;
  while (ancestor !== root) { try { if ((await fs.lstat(ancestor)).isSymbolicLink()) fail("Private run directory must not use symlinks."); } catch (e) { if (e.code !== "ENOENT") throw e; } ancestor = path.dirname(ancestor); }
  const manifest = JSON.parse(await fs.readFile(path.resolve(flags["--manifest"]), "utf8")); validateManifest(manifest);
  const api = new GoogleApi(await cliToken(root));
  const result = await executeMode(manifest, api, runDir, flags["--mode"]);
  process.stdout.write(JSON.stringify(result) + "\n");
}
module.exports = { RepairError, RepairRunner, GoogleApi, validateManifest, documentWrite, assertBefore, assertFields, assertGeneration, firestoreFieldsEqual, digestFile, canonical, hash, writableMetadata, executeMode, main };
if (require.main === module) main().catch(error => { process.stderr.write((error instanceof RepairError ? error.message : "Data repair stopped; inspect the private journal and retry only after reviewing its state.") + "\n"); process.exitCode = 1; });
