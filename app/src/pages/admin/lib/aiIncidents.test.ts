/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const updates: { path: string; data: any }[] = [];
  const documents = new Map<string, any>();
  const queries: any[] = [];
  const snapshot = (entries: [string, any][]) => ({ docs: entries.map(([path, data]) => ({ id: path.split("/").at(-1), data: () => data })) });
  function collection(path: string, clauses: any[] = []): any {
    const chain = (clause: any) => collection(path, [...clauses, clause]);
    return {
      doc: (id: string) => ({
        get: async () => ({ id, exists: documents.has(`${path}/${id}`), data: () => documents.get(`${path}/${id}`) }),
        update: async (data: any) => { updates.push({ path: `${path}/${id}`, data }); },
      }),
      where: (...args: any[]) => chain(["where", ...args]),
      orderBy: (...args: any[]) => chain(["orderBy", ...args]),
      limit: (value: number) => chain(["limit", value]),
      get: async () => {
        queries.push({ path, clauses });
        const limit = clauses.find(clause => clause[0] === "limit")?.[1] ?? Infinity;
        return snapshot([...documents.entries()].filter(([key]) => key.startsWith(`${path}/`)).slice(0, limit));
      },
    };
  }
  return { updates, documents, queries, db: { collection } };
});
vi.mock("../../../lib/firebase", () => ({
  default: { firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } } },
  auth: { currentUser: { uid: "admin-uid" } },
  db: fake.db,
}));

import {
  EMPTY_FILTERS, applyFilters, countable, facetValues, fieldRows, groupBreakdown, isStuck, jobSummary, loadStuckJobs,
  loggingLink, matchesSearch, normalizeIncident, pacificDate, pacificTime, playerIncidentsPath, readError, saveTriage,
  toDate, traceLink, triagePayload, triageProblem,
} from "./aiIncidents";
import type { AiIncident, TriageDraft } from "./aiIncidents";

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

// A gateway quota refusal with its folded phone half, as §3.1 and the fold write them.
const QUOTA = {
  schemaVersion: 1, source: "both", transport: "stream", kind: "refusal", severity: "warning",
  capability: "workout_chat", playerId: "player-1", requestedByUid: "uid-1", clientVersion: "1.4+31", platform: "ios",
  isTest: false, backfill: false, requestId: "3f2a9c1e-0b7d-4c55-9e1a-2d6f8b0c4e71", requestIdSource: "client",
  jobId: null, conversationId: "conv-9", code: "quota_exceeded", stage: "reserve", message: "Daily limit reached",
  httpStatus: 429, allowance: { bucket: "adjustment", used: 15, limit: 15, day: "2026-09-24", gate: "reserve_daily_allowance" },
  quota: null, degraded: [], messageLength: 42, hasClient: true, clientIncidentIds: ["client-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  client: { userSaw: "You've used today's workout builder turns.", errorCode: "quota_exceeded", surface: "workout_chat" },
  occurredAt: ts("2026-09-24T00:14:38Z"), createdAt: ts("2026-09-24T00:14:39Z"),
};
const HALF = {
  schemaVersion: 1, source: "client", transport: "stream", kind: "refusal", capability: "workout_chat",
  playerId: "player-1", requestedByUid: "uid-1", requestId: QUOTA.requestId, code: "quota_exceeded", stage: "workout_chat_send",
  foldedInto: "req-3f2a9c1e-0b7d-4c55-9e1a-2d6f8b0c4e71", createdAt: ts("2026-09-24T00:14:40Z"),
};
const BACKFILL = {
  schemaVersion: 1, source: "projection", transport: "job", kind: "failure", severity: "error", capability: "build_workout",
  playerId: "player-2", requestedByUid: "uid-2", isTest: false, backfill: true, requestId: "Job_AbC123", jobId: "Job_AbC123",
  code: "validation_failed", stage: null, message: "validation_failed: 2 violations: banned_phrase, missing_block",
  occurredAt: ts("2026-09-08T19:02:00Z"), createdAt: ts("2026-09-24T19:55:00Z"),
  triage: { state: "fixed", fixRef: "gateway 8029965", updatedAt: ts("2026-09-24T20:00:00Z"), updatedBy: "admin-uid" },
};
const SMOKE = {
  schemaVersion: 1, source: "gateway", transport: "stream", kind: "failure", capability: "pose_chat", playerId: "player-3",
  requestedByUid: "uid-3", isTest: true, requestId: "11111111-2222-4333-8444-555555555555", code: "provider_error",
  stage: "provider", occurredAt: ts("2026-09-11T16:00:00Z"), createdAt: ts("2026-09-11T16:00:01Z"),
};

function fixtures(): AiIncident[] {
  return [
    normalizeIncident("req-3f2a9c1e-0b7d-4c55-9e1a-2d6f8b0c4e71", QUOTA),
    normalizeIncident("client-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", HALF),
    normalizeIncident("job-Job_AbC123", BACKFILL),
    normalizeIncident("req-11111111-2222-4333-8444-555555555555", SMOKE),
  ];
}
const NAMES = new Map([["player-1", "Lena Ortiz"], ["player-2", "Sam Reyes"]]);

beforeEach(() => { fake.updates.length = 0; fake.documents.clear(); fake.queries.length = 0; });

describe("normalizeIncident", () => {
  it("reads every writer's shape and tolerates missing or mistyped fields", () => {
    const [quota, , backfill] = fixtures();
    expect(quota.allowance).toEqual(QUOTA.allowance);
    expect(quota.client?.userSaw).toBe("You've used today's workout builder turns.");
    expect(quota.occurredAt?.toISOString()).toBe("2026-09-24T00:14:38.000Z");
    expect(quota.triage.state).toBe("new");
    expect(backfill.stage).toBe("unknown");
    expect(backfill.triage).toMatchObject({ state: "fixed", fixRef: "gateway 8029965", updatedBy: "admin-uid" });
    const odd = normalizeIncident("x", { kind: 3, isTest: "true", degraded: [{ signal: "fallback_used" }, null], triage: { state: "reopened" }, allowance: "15/15" });
    expect(odd.kind).toBe("3");
    expect(odd.isTest).toBe(false);
    expect(odd.degraded).toEqual([{ signal: "fallback_used", detail: "" }, { signal: "unknown", detail: "" }]);
    expect(odd.triage.state).toBe("new");
    expect(odd.allowance).toBeNull();
    expect(normalizeIncident("empty", null)).toMatchObject({ code: "unknown", capability: "unknown", client: null, occurredAt: null });
  });

  it("converts Firestore timestamps, Dates, ISO strings and seconds maps", () => {
    expect(toDate(ts("2026-09-24T00:00:00Z"))?.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(toDate("2026-09-24T00:00:00Z")?.valueOf()).toBe(Date.UTC(2026, 8, 24));
    expect(toDate({ seconds: 1, nanoseconds: 5e8 })?.valueOf()).toBe(1500);
    expect(toDate("not a date")).toBeNull();
    expect(toDate(undefined)).toBeNull();
  });
});

describe("countable", () => {
  it("never counts a folded phone half as a second incident", () => {
    const all = fixtures();
    expect(countable(all).map(incident => incident.id)).not.toContain("client-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(countable(all)).toHaveLength(3);
    const withoutCanonical = all.filter(incident => !incident.id.startsWith("req-3f2a"));
    expect(countable(withoutCanonical).map(incident => incident.id)).not.toContain("client-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});

describe("Pacific time", () => {
  it("puts a 00:14Z refusal on the previous Pacific day, as the 5 pm allowance reset does", () => {
    expect(pacificDate(new Date("2026-09-24T00:14:38Z"))).toBe("2026-09-23");
    expect(pacificTime(new Date("2026-09-24T00:14:38Z"))).toMatch(/Sep 23.*5:14:38\sPM.*PDT/);
  });
  it("follows the switch to standard time", () => {
    expect(pacificDate(new Date("2026-11-01T09:30:00Z"))).toBe("2026-11-01");
    expect(pacificDate(new Date("2026-11-02T07:30:00Z"))).toBe("2026-11-01");
    expect(pacificTime(new Date("2026-11-02T07:30:00Z"))).toMatch(/PST/);
    expect(pacificTime(null)).toBe("—");
  });
});

describe("filters and search", () => {
  const visible = () => countable(fixtures());

  it("hides server-labelled test traffic by default and can show only it", () => {
    expect(applyFilters(visible(), EMPTY_FILTERS, NAMES).map(incident => incident.code)).toEqual(["quota_exceeded", "validation_failed"]);
    expect(applyFilters(visible(), { ...EMPTY_FILTERS, test: "test" }, NAMES).map(incident => incident.capability)).toEqual(["pose_chat"]);
    expect(applyFilters(visible(), { ...EMPTY_FILTERS, test: "all" }, NAMES)).toHaveLength(3);
  });

  it("filters on capability, code, kind, source and triage state", () => {
    const run = (patch: Partial<typeof EMPTY_FILTERS>) => applyFilters(visible(), { ...EMPTY_FILTERS, test: "all", ...patch }, NAMES).map(incident => incident.id);
    expect(run({ capability: "build_workout" })).toEqual(["job-Job_AbC123"]);
    expect(run({ code: "quota_exceeded" })).toEqual(["req-3f2a9c1e-0b7d-4c55-9e1a-2d6f8b0c4e71"]);
    expect(run({ kind: "failure" })).toHaveLength(2);
    expect(run({ source: "projection" })).toEqual(["job-Job_AbC123"]);
    expect(run({ triage: "fixed" })).toEqual(["job-Job_AbC123"]);
  });

  it("bounds dates by the Pacific calendar day, inclusive", () => {
    const run = (from: string, to: string) => applyFilters(visible(), { ...EMPTY_FILTERS, from, to }, NAMES).map(incident => incident.code);
    expect(run("2026-09-23", "2026-09-23")).toEqual(["quota_exceeded"]);
    expect(run("2026-09-24", "")).toEqual([]);
    expect(run("", "2026-09-08")).toEqual(["validation_failed"]);
  });

  it("finds an incident by the 8-character ref code, full ids, uid or athlete name", () => {
    const [quota, , backfill] = fixtures();
    expect(matchesSearch(quota, "3F2A9C1E", NAMES)).toBe(true);
    expect(matchesSearch(quota, "conv-9", NAMES)).toBe(true);
    expect(matchesSearch(quota, "uid-1", NAMES)).toBe(true);
    expect(matchesSearch(quota, "lena", NAMES)).toBe(true);
    expect(matchesSearch(quota, "sam", NAMES)).toBe(false);
    expect(matchesSearch(backfill, "job_abc123", NAMES)).toBe(true);
    expect(matchesSearch(backfill, "c123", NAMES)).toBe(false);
    expect(matchesSearch(quota, "client-aaaaaaaa", NAMES)).toBe(true);
    expect(matchesSearch(quota, "  ", NAMES)).toBe(true);
  });

  it("offers facet values most-frequent first", () => {
    expect(facetValues(countable(fixtures()), "kind")).toEqual([{ value: "failure", count: 2 }, { value: "refusal", count: 1 }]);
  });
});

describe("group-by breakdown", () => {
  it("keeps the backfilled 2026-09-08 and 2026-09-11 bursts as distinct Pacific days, newest first", () => {
    const burst = (day: string, n: number, code: string) => Array.from({ length: n }, (_, i) =>
      normalizeIncident(`job-${day}-${i}`, { code, kind: "refusal", backfill: true, occurredAt: ts(`${day}T18:0${i % 10}:00Z`) }));
    const rows = groupBreakdown([...burst("2026-09-08", 16, "invalid_request"), ...burst("2026-09-11", 6, "context_unavailable")], "day");
    expect(rows.map(row => [row.label, row.count])).toEqual([["2026-09-11", 6], ["2026-09-08", 16]]);
    expect(rows[0].value).toBe("2026-09-11");
  });
  it("sorts by size, and a class row names capability × code × stage without being a filter", () => {
    const rows = groupBreakdown(countable(fixtures()), "class");
    expect(rows[0].value).toBe("");
    expect(rows.map(row => row.label)).toContain("workout_chat · quota_exceeded · reserve");
    expect(groupBreakdown(countable(fixtures()), "code")[0].count).toBe(1);
  });
});

describe("links", () => {
  it("prefills Cloud Logging on labels.requestId and labels.jobId around the incident", () => {
    const [quota, , backfill] = fixtures();
    const url = loggingLink(quota)!;
    expect(url.startsWith("https://console.cloud.google.com/logs/query;query=")).toBe(true);
    expect(url.endsWith("?project=kickai-69dd0")).toBe(true);
    const query = decodeURIComponent(url.split(";query=")[1].split("?")[0]);
    expect(query).toBe(`(labels.requestId="${QUOTA.requestId}" OR labels.jobId="${QUOTA.requestId}")`
      + ' AND timestamp>="2026-09-23T23:14:38.000Z" AND timestamp<="2026-09-24T01:14:38.000Z"');
    expect(decodeURIComponent(loggingLink(backfill)!)).toContain('labels.jobId="Job_AbC123"');
    const undated = normalizeIncident("req-2", { requestId: "abc-123" });
    expect(decodeURIComponent(loggingLink(undated)!)).not.toContain("timestamp");
  });
  it("refuses to build a query from an id outside the id alphabet", () => {
    const hostile = normalizeIncident("req-x", { requestId: 'x" OR severity>=DEFAULT OR "', jobId: "" });
    expect(loggingLink(hostile)).toBeNull();
    expect(loggingLink(normalizeIncident("client-x", {}))).toBeNull();
  });
  it("links a gs:// trace ref to the Cloud Storage console and rejects traversal", () => {
    expect(traceLink("gs://posetek-llm-artifacts/trainingPlanContexts/p1/failed-abc/trace.json"))
      .toBe("https://console.cloud.google.com/storage/browser/_details/posetek-llm-artifacts/trainingPlanContexts/p1/failed-abc/trace.json?project=kickai-69dd0");
    expect(traceLink("gs://bucket/a/../b")).toBeNull();
    expect(traceLink("https://evil.test/x")).toBeNull();
    expect(playerIncidentsPath("p 1")).toBe("/admin/ai-incidents?q=p%201");
  });
});

describe("fieldRows", () => {
  it("orders known keys first, flattens one nested map, and turns values into plain strings", () => {
    const rows = fieldRows({ detail: "d", userSaw: "shown", pointer: { conversationId: "c", existed: false }, online: true, empty: "", none: null },
      ["userSaw", "detail"]);
    expect(rows).toEqual([["userSaw", "shown"], ["detail", "d"], ["online", "yes"], ["pointer.conversationId", "c"], ["pointer.existed", "no"]]);
  });
});

describe("triage", () => {
  const draft = (patch: Partial<TriageDraft>): TriageDraft => ({ state: "new", owner: "", note: "", fixRef: "", replayNote: "", ...patch });

  it("requires fixRef for fixed and replayNote for verified", () => {
    expect(triageProblem(draft({}))).toBeNull();
    expect(triageProblem(draft({ state: "fixed" }))).toMatch(/fix reference/);
    expect(triageProblem(draft({ state: "fixed", fixRef: "   " }))).toMatch(/fix reference/);
    expect(triageProblem(draft({ state: "fixed", fixRef: "gateway 6424b0e" }))).toBeNull();
    expect(triageProblem(draft({ state: "verified", fixRef: "gateway 6424b0e" }))).toMatch(/replay note/);
    expect(triageProblem(draft({ state: "verified", replayNote: "req-… from the 2026-09-25 replay" }))).toBeNull();
    expect(triageProblem(draft({ state: "wontfix" }))).toBeNull();
    expect(triageProblem(draft({ state: "closed" as any }))).toMatch(/state/);
    expect(triageProblem(draft({ note: "x".repeat(1001) }))).toMatch(/1000/);
    expect(triageProblem(draft({ state: "fixed", fixRef: "x".repeat(201) }))).toMatch(/200/);
  });

  it("writes only the rules' keys, trimmed, with empty strings left out", () => {
    const payload = triagePayload(draft({ state: "fixed", fixRef: " abc123 ", owner: "", note: " see PR " }), "admin-uid", "TS");
    expect(payload).toEqual({ state: "fixed", fixRef: "abc123", note: "see PR", updatedBy: "admin-uid", updatedAt: "TS" });
    expect(Object.keys(payload).every(key => ["state", "owner", "note", "fixRef", "replayNote", "updatedAt", "updatedBy"].includes(key))).toBe(true);
  });

  it("saves through an update confined to the triage map and refuses an invalid draft before writing", async () => {
    const saved = await saveTriage("req-1", draft({ state: "verified", replayNote: "no incident on replay 2026-09-25" }));
    expect(fake.updates).toEqual([{ path: "aiIncidents/req-1", data: { triage: {
      state: "verified", replayNote: "no incident on replay 2026-09-25", updatedAt: "SERVER_TIMESTAMP", updatedBy: "admin-uid",
    } } }]);
    expect(saved.state).toBe("verified");
    expect(saved.updatedAt).toBeInstanceOf(Date);
    await expect(saveTriage("req-1", draft({ state: "fixed" }))).rejects.toThrow(/fix reference/);
    expect(fake.updates).toHaveLength(1);
  });
});

describe("jobs", () => {
  it("summarizes a job without parameter values, the result or the error text", () => {
    const job = jobSummary("j1", {
      status: "failed", capability: "build_workout", params: { message: "athlete text", planId: "p" },
      result: { text: "model output" }, error: { code: "validation_failed", message: "banned phrase 'model output'" },
      createdAt: ts("2026-09-24T00:00:00Z"),
    });
    expect(job.paramKeys).toEqual(["message", "planId"]);
    expect(job.errorCode).toBe("validation_failed");
    expect(JSON.stringify(job)).not.toContain("athlete text");
    expect(JSON.stringify(job)).not.toContain("model output");
  });

  it("calls a pending or running job stuck only after 30 minutes", async () => {
    const now = Date.parse("2026-09-24T12:00:00Z");
    const at = (minutesAgo: number) => ts(new Date(now - minutesAgo * 60_000).toISOString());
    expect(isStuck(jobSummary("a", { status: "pending", createdAt: at(31) }), now)).toBe(true);
    expect(isStuck(jobSummary("b", { status: "running", createdAt: at(29) }), now)).toBe(false);
    expect(isStuck(jobSummary("c", { status: "failed", createdAt: at(90) }), now)).toBe(false);
    fake.documents.set("llmJobs/old", { status: "pending", createdAt: at(45) });
    fake.documents.set("llmJobs/new", { status: "running", createdAt: at(5) });
    const result = await loadStuckJobs(now);
    expect(result.jobs.map(job => job.id)).toEqual(["old"]);
    expect(fake.queries[0].clauses).toEqual([["where", "status", "in", ["pending", "running"]], ["orderBy", "createdAt", "desc"], ["limit", 101]]);
  });

  it("names a permission denial as the rules gap rather than an empty result", () => {
    expect(readError({ code: "permission-denied" }, "The incident log")).toMatch(/permission denied.*rules cutover/);
    expect(readError(new Error("boom"), "X")).toBe("X could not be read: boom.");
  });
});
