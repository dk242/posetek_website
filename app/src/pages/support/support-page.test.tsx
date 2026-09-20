import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { POLICY_CONTACT_EMAIL, POLICY_SECTIONS } from "../privacy/privacy-sections";
import SupportPage from "./SupportPage";
import { SUPPORT_EMAIL, SUPPORT_MAILTO, SUPPORT_QUESTIONS } from "./support-content";

const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/support"]}><SupportPage /></MemoryRouter>);

describe("support page", () => {
  it("gives App Review an easy way to contact us, matching the privacy policy's address", () => {
    expect(SUPPORT_EMAIL).toBe(POLICY_CONTACT_EMAIL);
    expect(html).toContain(`href="${SUPPORT_MAILTO.replace(/&/g, "&amp;")}"`);
    expect(html).toContain(`Email ${SUPPORT_EMAIL}`);
    expect(html).toContain("PoseTek Inc.");
  });

  it("answers every listed question once under a stable anchor", () => {
    expect(new Set(SUPPORT_QUESTIONS.map(entry => entry.id)).size).toBe(SUPPORT_QUESTIONS.length);
    const rendered = [...html.matchAll(/<div class="question" id="([^"]+)"/g)].map(match => match[1]);
    expect(rendered).toEqual(SUPPORT_QUESTIONS.map(entry => entry.id));
    for (const anchor of [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1])) expect(html).toContain(`id="${anchor}"`);
  });

  it("deep-links only to privacy policy sections that exist", () => {
    const targets = [...html.matchAll(/href="\/privacy#([^"]+)"/g)].map(match => match[1]);
    expect(targets.length).toBeGreaterThanOrEqual(3);
    const sections = new Set<string>(POLICY_SECTIONS.map(section => section.id));
    for (const target of targets) expect(sections.has(target)).toBe(true);
  });

  it("explains account deletion, which App Review asks for", () => {
    const answer = html.slice(html.indexOf('id="delete-account"'), html.indexOf('id="parents"'));
    expect(answer).toContain("ask us to delete your account");
    expect(answer).toContain("Deletion is permanent");
  });
});
