"use strict";

// aiCoachStreamProxy forwards the contract §16 request id and a web-only
// client tag to the gateway (AI observability plan §3.3).
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-test";
const admin = require("firebase-admin");
const { aiCoachStreamProxy } = require("./index");

const REQUEST_ID = "3f0c9a4e-8b1d-4c2e-9f3a-5b6c7d8e9f01";

function fakeResponse() {
  const res = {
    statusCode: 200, headers: {}, chunks: [], ended: false, headersSent: false, destroyed: false, writableEnded: false,
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; return this; },
    send(body) { this.body = body; this.ended = true; return this; },
    write(chunk) { this.headersSent = true; this.chunks.push(Buffer.from(chunk).toString()); },
    end() { this.ended = true; this.writableEnded = true; },
    on() {},
  };
  return res;
}

async function call(headers) {
  const sent = [];
  const originalFetch = global.fetch;
  // index.js initialized the default app; admin.auth() returns its cached instance.
  const auth = admin.auth();
  const originalVerify = auth.verifyIdToken;
  global.fetch = async (url, init) => {
    sent.push(init.headers);
    return { status: 200, headers: { get: () => "text/event-stream" }, body: [Buffer.from("event: done\ndata: {}\n\n")] };
  };
  auth.verifyIdToken = async () => ({ uid: "athlete" });
  const lower = Object.fromEntries(Object.entries({ origin: "http://localhost:5173", authorization: "Bearer token", ...headers })
    .map(([key, value]) => [key.toLowerCase(), value]));
  const req = { method: "POST", body: { capability: "pose_chat" }, get: name => lower[name.toLowerCase()], on() {} };
  const res = fakeResponse();
  try {
    await aiCoachStreamProxy(req, res);
  } finally {
    global.fetch = originalFetch;
    auth.verifyIdToken = originalVerify;
  }
  return { res, sent };
}

test("the proxy allows and forwards a valid request id and a web client tag", async () => {
  const { res, sent } = await call({ "X-PoseTek-Request-Id": REQUEST_ID, "X-PoseTek-Client": "web/athlete-portal" });
  assert.match(res.headers["access-control-allow-headers"], /X-PoseTek-Request-Id, X-PoseTek-Client/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]["X-PoseTek-Request-Id"], REQUEST_ID);
  assert.equal(sent[0]["X-PoseTek-Client"], "web/athlete-portal");
});

test("a malformed request id is dropped and a non-web tag cannot claim test traffic", async () => {
  const { sent } = await call({ "X-PoseTek-Request-Id": REQUEST_ID.toUpperCase(), "X-PoseTek-Client": "smoke/release" });
  assert.equal(sent[0]["X-PoseTek-Request-Id"], undefined);
  assert.equal(sent[0]["X-PoseTek-Client"], "web/proxy");
});
