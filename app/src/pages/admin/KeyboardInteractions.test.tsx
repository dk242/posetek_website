// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../lib/firebase", () => ({ default: {}, auth: {}, db: {} }));

import { IncidentDrawer } from "./views/AiIncidents";
import { normalizeIncident } from "./lib/aiIncidents";
import { InsightTabs } from "../insights/InsightsPage";
import { expandedRequest } from "../insights/lib/expandedQuery";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ""; });

function mount(node: ReactNode) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<MemoryRouter>{node}</MemoryRouter>));
  cleanup = () => act(() => root.unmount());
  return host;
}

describe("admin keyboard controls", () => {
  it("moves Insights tabs with arrows, Home and End and keeps one tab in the tab order", async () => {
    const request = expandedRequest("view=overview", new Date("2026-09-26T12:00:00Z"));
    const change = vi.fn();
    mount(<InsightTabs request={request} onChange={change} />);
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(change).toHaveBeenLastCalledWith({ view: "testing" });
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(change).toHaveBeenLastCalledWith({ view: "usage" });
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(change).toHaveBeenLastCalledWith({ view: "overview" });
  });

  it("focuses the incident dialog, traps Tab, handles Escape and returns focus", () => {
    const opener = document.createElement("button"); opener.textContent = "Open"; document.body.append(opener); opener.focus();
    const incident = normalizeIncident("client-test", { source: "client", requestedByUid: "athlete", code: "failed", capability: "training" });
    const close = vi.fn();
    mount(<IncidentDrawer incident={incident} halves={[]} onClose={close} onSaved={() => {}} />);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const closeButton = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    expect(document.activeElement).toBe(closeButton);
    expect(dialog.getAttribute("aria-labelledby")).toBe("ai-drawer-title");
    const focusables = [...dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && (element.tagName === "SUMMARY" || !element.closest('details:not([open])')));
    const last = focusables.at(-1)!; last.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(closeButton);
    closeButton.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1);
    cleanup?.(); cleanup = null;
    expect(document.activeElement).toBe(opener);
  });
});
