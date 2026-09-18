import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../../../lib/firebase", () => ({ auth: {} }));
vi.mock("../../../lib/organization-data", () => ({ clubCall: vi.fn() }));
import { SignupInvitationControls } from "./SignupStatus";
import type { InvitationView } from "../lib/invitation";

function render(invitation: InvitationView["invitation"], extra: Partial<InvitationView> = {}) {
  return renderToStaticMarkup(<SignupInvitationControls playerName="Example Player" view={{ invitation, pending: null, message: "", error: false, ...extra }} onGenerate={() => {}} onRetry={() => {}} onCopy={() => {}} />);
}
describe("compact invitation controls", () => {
  it("shows a masked existing code and copy actions, without generation", () => {
    const html = render({ playerId: "player", status: "ready", code: "SAMPLE-123", signupUrl: "https://posetek.net/signin#playerCode=SAMPLE-123" });
    expect(html).toContain('data-clarity-mask="true"'); expect(html).toContain("SAMPLE-123");
    expect(html).toContain('aria-label="Copy signup link for Example Player"'); expect(html).toContain('aria-label="Copy signup code for Example Player"');
    expect(html).not.toContain("Generate code"); expect(html).not.toContain("#playerCode=");
  });
  it("shows generation only after confirmed missing, and guides existing accounts", () => {
    expect(render({ playerId: "player", status: "missing" })).toContain("Generate code");
    const claimed = render({ playerId: "player", status: "claimed" });
    expect(claimed).toContain("existing account"); expect(claimed).not.toContain("<button");
    const loading = render(null, { pending: "loading" }); expect(loading).toContain("Checking invitation"); expect(loading).not.toContain("Generate code");
  });
  it("announces lookup failures and offers read-only retry, without generate", () => {
    const html = render(null, { error: true, message: "You do not have permission to manage this player’s invitation." });
    expect(html).toContain('role="status"'); expect(html).toContain("Retry invitation"); expect(html).toContain("do not have permission"); expect(html).not.toContain("Generate code");
  });
});
