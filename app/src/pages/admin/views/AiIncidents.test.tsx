// Every client-written string renders as an escaped text node (§3.4): the
// template this page replaces used innerHTML, so these fixtures carry markup in
// each field a phone, an athlete or a model can influence.

import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../lib/firebase", () => ({ default: {}, auth: {}, db: {} }));

import { IncidentDrawer, IncidentRow, TriageForm } from "./AiIncidents";
import { PlayerAiIncidentsCard } from "./PlayerAiIncidents";
import { normalizeIncident } from "../lib/aiIncidents";

const SCRIPT = `<script>alert("x")</script>`;
const IMG = `<img src=x onerror="alert(1)">`;

const hostile = normalizeIncident("req-3f2a9c1e-0b7d-4c55-9e1a-2d6f8b0c4e71", {
  schemaVersion: 1, source: "both", transport: "stream", kind: "refusal", capability: `workout_chat${IMG}`,
  code: `quota_exceeded${SCRIPT}`, stage: "reserve", playerId: "player-1", requestedByUid: "uid-1",
  requestId: "3f2a9c1e-0b7d-4c55-9e1a-2d6f8b0c4e71", message: `limit ${SCRIPT}`,
  allowance: { bucket: "adjustment", used: 15, limit: 15, gate: `reserve${IMG}` },
  degraded: [{ signal: "fallback_used", detail: SCRIPT }],
  client: {
    detail: SCRIPT, userSaw: `Couldn't reload ${IMG}`, surface: "workout_chat",
    pointer: { conversationId: SCRIPT, existed: false }, breadcrumbTail: `llm.error ${SCRIPT}`,
  },
  userReport: { note: `It broke ${SCRIPT}` },
  traceRef: `gs://bucket/${SCRIPT}`,
  triage: { state: "fixed", fixRef: SCRIPT, note: IMG },
  occurredAt: { toDate: () => new Date("2026-09-24T00:14:38Z") },
});

function markup(node: ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

function expectEscaped(html: string) {
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<img");
  // Escaped text may still spell "onerror"; an injected attribute would need a raw quote.
  expect(html).not.toMatch(/onerror="/);
  expect(html).toContain("&lt;script&gt;");
}

describe("AI incident rendering", () => {
  it("escapes every client-written string in the drawer, including the phone half and the athlete's report", () => {
    const html = markup(<IncidentDrawer incident={hostile} name={`Lena ${SCRIPT}`} halves={[]} onClose={() => {}} onSaved={() => {}} />);
    expectEscaped(html);
    expect(html).toContain("It broke &lt;script&gt;");
    expect(html).toContain("Couldn&#x27;t reload &lt;img");
    expect(html).toContain("llm.error &lt;script&gt;");
    // Both halves, the allowance and the Cloud Logging link are present.
    expect(html).toContain("Gateway half");
    expect(html).toContain("Phone half");
    expect(html).toContain("allowance.used");
    expect(html).toContain("https://console.cloud.google.com/logs/query;query=");
    expect(html).toContain("/admin/accounts/player/player-1");
  });

  it("escapes the list row and the athlete page's section", () => {
    expectEscaped(markup(<IncidentRow incident={hostile} name={`Lena ${SCRIPT}`} to="?incident=x" />));
    expectEscaped(markup(<PlayerAiIncidentsCard playerId="player-1" load={{ kind: "ready", incidents: [hostile] }} />));
  });

  it("escapes stored triage text in the form fields", () => {
    const html = markup(<TriageForm incident={hostile} onSaved={() => {}} />);
    expectEscaped(html);
    expect(html).toContain("Fix reference (required)");
  });

  it("says when there is no phone half or no gateway record instead of leaving a blank column", () => {
    const gatewayOnly = normalizeIncident("req-1", { source: "gateway", code: "provider_error", requestId: "abc" });
    expect(markup(<IncidentDrawer incident={gatewayOnly} halves={[]} onClose={() => {}} onSaved={() => {}} />)).toContain("No phone half");
    const clientOnly = normalizeIncident("client-1", { source: "client", code: "recovery_failed" });
    expect(markup(<IncidentDrawer incident={clientOnly} halves={[]} onClose={() => {}} onSaved={() => {}} />)).toContain("never reached the gateway");
  });
});
