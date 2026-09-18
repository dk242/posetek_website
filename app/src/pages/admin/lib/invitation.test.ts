import { describe, expect, it, vi } from "vitest";
import { invitationController } from "./invitation";
import type { InvitationView } from "./invitation";

const ready = { playerId: "player", status: "ready", code: "SAMPLE-123", signupUrl: "https://posetek.net/signin#playerCode=SAMPLE-123" };
function setup(response: unknown = ready) {
  const states: InvitationView[] = [];
  const port = { read: vi.fn().mockResolvedValue(response), ensure: vi.fn().mockResolvedValue(ready), copy: vi.fn().mockResolvedValue(undefined), isCurrent: vi.fn(() => true) };
  const controller = invitationController("player", port, state => states.push(state));
  return { controller, port, states, last: () => states.at(-1)! };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("invitation control operations", () => {
  it("reads existing codes and repeatedly copies without ensure, rotation or account creation", async () => {
    const { controller, port, last } = setup();
    await controller.load(); await controller.copy("link"); await controller.copy("link"); await controller.copy("code"); await controller.generate();
    expect(port.read.mock.calls).toEqual([["player"], ["player"], ["player"], ["player"]]);
    expect(port.ensure).not.toHaveBeenCalled();
    expect(port.copy.mock.calls).toEqual([[ready.signupUrl], [ready.signupUrl], [ready.code]]);
    expect(last().invitation).toEqual(ready);
  });
  it("does not generate before the getter confirms missing; generates only once during a pending request", async () => {
    const { controller, port, last } = setup({ playerId: "player", status: "missing" });
    await controller.generate(); expect(port.ensure).not.toHaveBeenCalled();
    await controller.load(); expect(last().invitation?.status).toBe("missing");
    const pending = deferred<unknown>(); port.ensure.mockReturnValueOnce(pending.promise);
    const first = controller.generate(); await controller.generate();
    expect(last().invitation).toBeNull(); expect(last().pending).toBe("generating");
    pending.resolve(ready); await first;
    port.read.mockResolvedValueOnce(ready);
    await controller.copy("link"); expect(port.ensure).toHaveBeenCalledTimes(1);
    expect(last().invitation).toEqual(ready);
  });
  it("accepts ensure’s compatible success shape without status and handles a claimed precondition race", async () => {
    const first = setup({ playerId: "player", status: "missing" });
    first.port.ensure.mockResolvedValue({ playerId: "player", code: ready.code, signupUrl: ready.signupUrl, writes: 0 });
    await first.controller.load(); await first.controller.generate(); expect(first.last().invitation).toEqual(ready);
    const race = setup({ playerId: "player", status: "missing" }); await race.controller.load();
    race.port.ensure.mockRejectedValue({ code: "functions/failed-precondition" });
    race.port.read.mockResolvedValue({ playerId: "player", status: "claimed" });
    await race.controller.generate(); expect(race.last().invitation?.status).toBe("claimed");
    expect(race.port.ensure).toHaveBeenCalledTimes(1);
  });
  it("keeps a failed-precondition or authorization failure truthful after the narrow reread", async () => {
    const first = setup({ playerId: "player", status: "missing" }); await first.controller.load();
    first.port.ensure.mockRejectedValue({ code: "functions/failed-precondition" }); await first.controller.generate();
    expect(first.last().message).toContain("has not been replaced");
    await first.controller.load(); first.port.read.mockRejectedValue({ code: "functions/permission-denied" }); await first.controller.generate();
    expect(first.last().message).toContain("do not have permission"); expect(first.last().invitation).toBeNull();
  });
  it("never generates or copies for a claimed player, including a concurrent claim during ensure", async () => {
    const claimed = { playerId: "player", status: "claimed" };
    const first = setup(claimed); await first.controller.load(); await first.controller.generate(); await first.controller.copy("link");
    expect(first.port.ensure).not.toHaveBeenCalled(); expect(first.port.copy).not.toHaveBeenCalled();
    const race = setup({ playerId: "player", status: "missing" }); race.port.ensure.mockResolvedValue(claimed);
    await race.controller.load(); await race.controller.generate(); await race.controller.copy("link");
    expect(race.last().invitation).toEqual(claimed); expect(race.port.copy).not.toHaveBeenCalled();
  });
  it("does not turn an unauthorized/error response into a missing invitation", async () => {
    const { controller, port, last } = setup(); port.read.mockRejectedValueOnce({ code: "functions/permission-denied", message: ready.code });
    await controller.load(); await controller.generate();
    expect(last().invitation).toBeNull(); expect(last().message).toContain("do not have permission");
    expect(last().message).not.toContain(ready.code); expect(port.ensure).not.toHaveBeenCalled();
    await controller.load(); expect(last().invitation).toEqual(ready);
  });
  it("drops stale reads after disposal, identity change or replacement load", async () => {
    const old = deferred<unknown>(), first = setup(); first.port.read.mockReturnValueOnce(old.promise);
    const load = first.controller.load(); first.controller.dispose(); old.resolve(ready); await load;
    expect(first.states.every(state => state.invitation === null)).toBe(true);
    const auth = setup(); auth.port.isCurrent.mockReturnValue(false); await auth.controller.load(); await auth.controller.copy("code"); expect(auth.port.read).not.toHaveBeenCalled();
    const pending = deferred<unknown>(), fresh = setup(); fresh.port.read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ playerId: "player", status: "claimed" });
    const stale = fresh.controller.load(); await fresh.controller.load(); pending.resolve(ready); await stale;
    expect(fresh.last().invitation?.status).toBe("claimed");
  });
  it("clears ready secrets during refresh and rejects late clipboard responses", async () => {
    const { controller, port, last } = setup(); await controller.load();
    const pending = deferred<void>(); port.copy.mockReturnValueOnce(pending.promise); const copy = controller.copy("link");
    await Promise.resolve(); expect(port.copy).toHaveBeenCalledTimes(1);
    port.read.mockResolvedValueOnce({ playerId: "player", status: "claimed" }); await controller.load(); pending.resolve(); await copy;
    expect(last().invitation?.status).toBe("claimed"); expect(last().message).toBe("");
  });
  it.each(["claimed", "missing"])("rechecks before copy and reflects a newly %s invitation without copying", async status => {
    const { controller, port, last } = setup(); await controller.load();
    port.read.mockResolvedValueOnce({ playerId: "player", status });
    await controller.copy("link"); expect(last().invitation).toEqual({ playerId: "player", status });
    expect(port.copy).not.toHaveBeenCalled(); expect(port.ensure).not.toHaveBeenCalled();
  });
  it("copies a fresh replacement code or link, never the previously displayed value", async () => {
    const { controller, port, last } = setup(); await controller.load();
    const replacement = { ...ready, code: "CHANGED-123", signupUrl: "https://posetek.net/signin#playerCode=CHANGED-123" };
    port.read.mockResolvedValue(replacement);
    await controller.copy("link"); await controller.copy("code");
    expect(port.copy.mock.calls).toEqual([[replacement.signupUrl], [replacement.code]]);
    expect(last().invitation).toEqual(replacement); expect(port.ensure).not.toHaveBeenCalled();
  });
  it.each(["identity", "dispose", "refresh"])("clears the old secret while checking copy and blocks a late response after %s", async change => {
    const { controller, port, last } = setup(); await controller.load();
    const pending = deferred<unknown>(); port.read.mockReturnValueOnce(pending.promise);
    const copy = controller.copy("code"); expect(last().invitation).toBeNull(); expect(last().pending).toBe("copying");
    if (change === "identity") port.isCurrent.mockReturnValue(false);
    if (change === "dispose") controller.dispose();
    if (change === "refresh") { port.read.mockResolvedValueOnce({ playerId: "player", status: "claimed" }); await controller.load(); }
    pending.resolve(ready); await copy;
    expect(port.copy).not.toHaveBeenCalled(); expect(port.ensure).not.toHaveBeenCalled();
    expect(last().invitation?.status).not.toBe("ready");
  });
  it("clears stale code and reports fresh getter authorization failure without copying", async () => {
    const { controller, port, last } = setup(); await controller.load();
    port.read.mockRejectedValueOnce({ code: "functions/permission-denied", message: ready.code }); await controller.copy("link");
    expect(last().invitation).toBeNull(); expect(last().message).toContain("do not have permission");
    expect(last().message).not.toContain(ready.code); expect(port.copy).not.toHaveBeenCalled(); expect(port.ensure).not.toHaveBeenCalled();
  });
  it("keeps manual code copy available when clipboard access is denied", async () => {
    const { controller, port, last } = setup(); await controller.load(); port.copy.mockRejectedValue(new Error(ready.code)); await controller.copy("link");
    expect(last().invitation).toEqual(ready); expect(last().error).toBe(true); expect(last().message).toContain("Select the code"); expect(last().message).not.toContain(ready.code);
  });
});
