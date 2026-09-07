"use strict";

// Import a public club logo once, then serve the immutable PNG from Firebase.
// HTTPS requests pin a validated public DNS answer, including every redirect.
const https = require("node:https");
const dns = require("node:dns/promises");
const net = require("node:net");
const crypto = require("node:crypto");
const { isClubAdmin, activeMember } = require("./club-access");
const { playerSegment } = require("./athlete-storage-paths");

const HTML_LIMIT = 1024 * 1024;
const PNG_LIMIT = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const blocked = new net.BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]]) blocked.addSubnet(address, prefix, "ipv4");

function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter the club's public HTTPS website address."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || net.isIP(url.hostname) || !url.hostname.includes(".") || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal") || String(value).length > 2048) throw new Error("Use a public HTTPS website without credentials or a custom port.");
  url.hash = "";
  return url;
}

async function publicAddress(hostname, resolve = dns.resolve4) {
  // IPv4-only retrieval keeps all destination validation in one address family.
  const addresses = await resolve(hostname);
  if (!addresses.length || addresses.some((address) => net.isIP(address) !== 4 || blocked.check(address, "ipv4"))) throw new Error("The website must resolve only to public internet addresses.");
  return addresses[0];
}

async function fetchPublic(value, limit, redirects = 0) {
  const url = publicUrl(value);
  const address = await publicAddress(url.hostname);
  const response = await new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false,
      headers: { "User-Agent": "PoseTek-Club-Branding/1.0", "Accept-Encoding": "identity", Accept: "text/html,image/png" },
      lookup: (_host, options, callback) => options?.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        resolve({ redirect: res.headers.location });
        return;
      }
      if (res.statusCode !== 200 || Number(res.headers["content-length"] || 0) > limit || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) {
        res.destroy(); reject(new Error("The website did not return a supported, bounded response.")); return;
      }
      const chunks = []; let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) res.destroy(new Error("The website response is too large."));
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ buffer: Buffer.concat(chunks), contentType: String(res.headers["content-type"] || "").split(";")[0], url: url.href }));
    });
    request.setTimeout(10000, () => request.destroy(new Error("The website took too long to respond.")));
    // Wall-clock deadline also bounds slow responses that trickle bytes.
    const deadline = setTimeout(() => request.destroy(new Error("The website took too long to respond.")), 15000);
    request.on("close", () => clearTimeout(deadline));
    request.on("error", reject);
  });
  if (Object.hasOwn(response, "redirect")) {
    if (!response.redirect || redirects >= 3) throw new Error("The website redirected too many times.");
    return fetchPublic(new URL(response.redirect, url).href, limit, redirects + 1);
  }
  return response;
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4]).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return result;
}

function logoCandidates(html, baseUrl) {
  const candidates = [];
  for (const tag of html.match(/<(?:img|meta|link)\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    let source, score = 0;
    if (/^<img/i.test(tag)) {
      source = attrs.src || attrs["data-src"];
      if (/logo|crest|badge/i.test(attrs.alt || "")) score += 100;
      if (/logo|crest|badge/i.test(source || "")) score += 30;
      if (Number(attrs.width) > 0 && Number(attrs.height) > 0) score += 5;
      const aspect = Number(attrs.width) / Number(attrs.height);
      if (aspect >= 0.6 && aspect <= 1.6) score += 20;
    } else if (/^<meta/i.test(tag) && attrs.property === "og:image") { source = attrs.content; score = 10; }
    else if (/^<link/i.test(tag) && /icon/i.test(attrs.rel || "")) { source = attrs.href; score = 5; }
    if (!source || !score) continue;
    try {
      const url = publicUrl(new URL(source, baseUrl).href);
      if (!/\.png$/i.test(url.pathname)) continue;
      candidates.push({ url: url.href, score });
    } catch { /* Unsupported source is not a fetch candidate. */ }
  }
  return [...new Set(candidates.sort((a, b) => b.score - a.score).map((item) => item.url))].slice(0, 6);
}

function validatePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > PNG_LIMIT || buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString("ascii", 12, 16) !== "IHDR" || buffer.readUInt32BE(8) !== 13) throw new Error("The logo must be a PNG image smaller than 2 MB.");
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16000000) throw new Error("The logo dimensions are not supported.");
  let offset = 8, dataFound = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString("ascii", offset + 4, offset + 8);
    if (length > PNG_LIMIT || offset + length + 12 > buffer.length) throw new Error("The PNG logo is incomplete.");
    if (type === "IDAT") dataFound = true;
    offset += length + 12;
    if (type === "IEND") {
      if (length !== 0 || offset !== buffer.length || !dataFound) throw new Error("The PNG logo is incomplete.");
      return { width, height };
    }
  }
  throw new Error("The PNG logo is incomplete.");
}

function createClubBranding({ db, bucket, FieldValue, HttpsError, retrieve = fetchPublic }) {
  async function authorize(organizationId, auth, transaction) {
    if (!auth?.uid || auth.isAnonymous) throw new HttpsError("unauthenticated", "Sign in to continue.");
    if (!playerSegment(organizationId)) throw new HttpsError("invalid-argument", "Choose a valid organization.");
    const ref = db.collection("organizations").doc(organizationId);
    const read = (target) => transaction ? transaction.get(target) : target.get();
    const org = await read(ref);
    if (!org.exists || org.data().schemaVersion !== 2) throw new HttpsError("not-found", "That club could not be found.");
    if (!isClubAdmin(auth)) {
      const member = await read(ref.collection("members").doc(auth.uid));
      if (!member.exists || !activeMember(member.data(), auth.uid) || member.data().role !== "manager") throw new HttpsError("permission-denied", "A club manager or PoseTek admin must update the logo.");
    }
    return ref;
  }
  async function importClubLogo({ organizationId, websiteUrl }, auth) {
    await authorize(organizationId, auth);
    let page, selected;
    try {
      const url = publicUrl(websiteUrl);
      page = await retrieve(url.href, HTML_LIMIT);
      if (!["text/html", "application/xhtml+xml"].includes(page.contentType)) throw new Error("Enter the club's website home page.");
      for (const candidate of logoCandidates(page.buffer.toString("utf8"), page.url)) {
        try {
          const image = await retrieve(candidate, PNG_LIMIT);
          if (image.contentType !== "image/png") continue;
          validatePng(image.buffer);
          selected = image; break;
        } catch { /* Try the next public PNG identified in the page. */ }
      }
      if (!selected) throw new Error("No supported PNG logo was found on that page. Use the club's official home page.");
    } catch (error) { throw new HttpsError("invalid-argument", error.message); }
    // The content hash makes retries and replacements immutable/cache-safe.
    const digest = crypto.createHash("sha256").update(selected.buffer).digest("hex");
    const logoStoragePath = `organizations/${organizationId}/branding/${digest}.png`;
    await authorize(organizationId, auth);
    await bucket.file(logoStoragePath).save(selected.buffer, { resumable: false, contentType: "image/png", metadata: { cacheControl: "public,max-age=31536000,immutable", metadata: { sourceUrl: selected.url } } });
    const metadata = { logoStoragePath, logoUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(logoStoragePath)}?alt=media`, logoSourceUrl: selected.url, websiteUrl: page.url };
    // Recheck authority after network IO. A revoked manager cannot publish.
    await db.runTransaction(async (transaction) => {
      const ref = await authorize(organizationId, auth, transaction);
      transaction.update(ref, { ...metadata, logoUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    });
    return metadata;
  }
  return { importClubLogo };
}

module.exports = { createClubBranding, publicUrl, publicAddress, fetchPublic, logoCandidates, validatePng };
