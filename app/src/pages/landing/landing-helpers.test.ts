import { describe, expect, it } from "vitest";
import { generateCode, getSafeReturnToUrl } from "./landing-helpers";

const ORIGIN = "https://posetek.example";
const BASE = `${ORIGIN}/kickai.html`;

function url(returnTo: string): string {
  return "?returnTo=" + encodeURIComponent(returnTo);
}

describe("generateCode", () => {
  it("returns 6 chars from the legacy charset by default (no I, no O)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ0-9]{6}$/);
    }
  });

  it("prepends the prefix and appends `length` random chars", () => {
    const code = generateCode("ORG", 6);
    expect(code.startsWith("ORG")).toBe(true);
    expect(code).toHaveLength(9);

    const coach = generateCode("COACH", 4);
    expect(coach.startsWith("COACH")).toBe(true);
    expect(coach).toHaveLength(9);

    const plr = generateCode("PLR", 4);
    expect(plr.startsWith("PLR")).toBe(true);
    expect(plr).toHaveLength(7);
  });
});

describe("getSafeReturnToUrl", () => {
  it("returns null when there is no returnTo param", () => {
    expect(getSafeReturnToUrl("", BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl("?foo=bar", BASE, ORIGIN)).toBeNull();
  });

  it("returns null for an empty returnTo value", () => {
    expect(getSafeReturnToUrl("?returnTo=", BASE, ORIGIN)).toBeNull();
  });

  it("allows a relative allowlisted page and preserves its query string", () => {
    expect(getSafeReturnToUrl(url("profile.html?player=abc123"), BASE, ORIGIN)).toBe(
      `${ORIGIN}/profile.html?player=abc123`,
    );
  });

  it("allows every page on the legacy allowlist", () => {
    const allowed = [
      "profile.html",
      "coachesview.html",
      "broadJumpPage.html",
      "changeOfDirectionPage.html",
      "dribblingPage.html",
      "kickingview.html",
      "sprintPage.html",
      "StaticJumpPage.html",
      "freeRecordPage.html",
    ];
    for (const file of allowed) {
      expect(getSafeReturnToUrl(url(file), BASE, ORIGIN)).toBe(`${ORIGIN}/${file}`);
    }
  });

  it("matches the allowlist case-sensitively, like legacy", () => {
    expect(getSafeReturnToUrl(url("staticjumppage.html"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("StaticJumpPage.html"), BASE, ORIGIN)).toBe(`${ORIGIN}/StaticJumpPage.html`);
  });

  it("rejects same-origin pages that are not on the allowlist", () => {
    expect(getSafeReturnToUrl(url("index.html"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("kickai.html"), BASE, ORIGIN)).toBeNull();
  });

  it("rejects absolute URLs on a different origin even when the file name matches", () => {
    expect(getSafeReturnToUrl(url("https://evil.example/profile.html"), BASE, ORIGIN)).toBeNull();
  });

  it("rejects protocol-relative URLs to another host", () => {
    expect(getSafeReturnToUrl(url("//evil.example/profile.html"), BASE, ORIGIN)).toBeNull();
  });

  it("rejects javascript: URLs", () => {
    expect(getSafeReturnToUrl(url("javascript:alert(1)"), BASE, ORIGIN)).toBeNull();
  });

  it("accepts an absolute same-origin URL to an allowlisted page (legacy matched only the last path segment)", () => {
    expect(getSafeReturnToUrl(url(`${ORIGIN}/profile.html?player=X&userType=player`), BASE, ORIGIN)).toBe(
      `${ORIGIN}/profile.html?player=X&userType=player`,
    );
  });

  it("accepts the clean SPA routes that alias allowlisted pages, with query strings intact", () => {
    expect(getSafeReturnToUrl(url("/athlete?player=X&view=drills"), BASE, ORIGIN)).toBe(
      `${ORIGIN}/athlete?player=X&view=drills`,
    );
    expect(getSafeReturnToUrl(url("/roster?userType=coach"), BASE, ORIGIN)).toBe(`${ORIGIN}/roster?userType=coach`);
    expect(getSafeReturnToUrl(url("/drills/broad-jump?share=tok"), BASE, ORIGIN)).toBe(
      `${ORIGIN}/drills/broad-jump?share=tok`,
    );
    expect(getSafeReturnToUrl(url("/drills/change-of-direction"), BASE, ORIGIN)).toBe(
      `${ORIGIN}/drills/change-of-direction`,
    );
    expect(getSafeReturnToUrl(url("/drills/dribbling"), BASE, ORIGIN)).toBe(`${ORIGIN}/drills/dribbling`);
  });

  it("rejects clean routes that are not ported auth destinations", () => {
    expect(getSafeReturnToUrl(url("/signin"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("/privacy"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("/drills/unknown"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("https://evil.example/athlete"), BASE, ORIGIN)).toBeNull();
  });
});
