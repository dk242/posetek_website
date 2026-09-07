import { describe, expect, it } from "vitest";
import { findCoach, findPlayer, ownsPlayer, type IdentityDb, type IdentityDoc } from "./identity";

function doc(id: string, data: Record<string, unknown> | null): IdentityDoc {
  return { id, exists: data !== null, data: () => (data === null ? undefined : data) };
}

interface FakeOptions {
  docs?: Record<string, Record<string, Record<string, unknown>>>;
  denyDirect?: boolean;
}

function fakeDb(options: FakeOptions = {}): IdentityDb & { queries: string[] } {
  const store = options.docs ?? {};
  const queries: string[] = [];
  return {
    queries,
    collection(name: string) {
      const rows = store[name] ?? {};
      return {
        doc(id: string) {
          return {
            async get() {
              if (options.denyDirect) {
                throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
              }
              return doc(id, rows[id] ?? null);
            },
          };
        },
        where(field: string, _op: "==", value: unknown) {
          return {
            limit() {
              return {
                async get() {
                  queries.push(`${name}.${field}=${String(value)}`);
                  const hits = Object.entries(rows).filter(([, data]) => data[field] === value).map(([id, data]) => doc(id, data));
                  return { empty: hits.length === 0, docs: hits };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("ownsPlayer", () => {
  it("accepts a document whose id is the uid and carries no conflicting owner field", () => {
    expect(ownsPlayer(doc("uid-1", { firstName: "A" }), "uid-1")).toBe(true);
  });
  it("accepts a document owned through authenticationUID or userUID", () => {
    expect(ownsPlayer(doc("p1", { authenticationUID: "uid-1" }), "uid-1")).toBe(true);
    expect(ownsPlayer(doc("p1", { userUID: "uid-1" }), "uid-1")).toBe(true);
  });
  it("rejects a document whose owner field names a different uid, even when the id matches", () => {
    expect(ownsPlayer(doc("uid-1", { userUID: "someone-else" }), "uid-1")).toBe(false);
    expect(ownsPlayer(doc("p1", { authenticationUID: "uid-1", userUID: "someone-else" }), "uid-1")).toBe(false);
  });
  it("rejects missing documents and missing uids", () => {
    expect(ownsPlayer(doc("p1", null), "uid-1")).toBe(false);
    expect(ownsPlayer(null, "uid-1")).toBe(false);
    expect(ownsPlayer(doc("uid-1", {}), "")).toBe(false);
  });
});

describe("findCoach", () => {
  it("returns the direct document only when its userUID matches, else the userUID query", () => {
    return (async () => {
      const db = fakeDb({ docs: { coaches: { "uid-1": { userUID: "uid-1" } } } });
      expect((await findCoach(db, "uid-1"))?.id).toBe("uid-1");
      expect(db.queries).toEqual([]);

      const mismatched = fakeDb({ docs: { coaches: { "uid-1": { userUID: "other" }, c9: { userUID: "uid-1" } } } });
      expect((await findCoach(mismatched, "uid-1"))?.id).toBe("c9");
      expect(mismatched.queries).toEqual(["coaches.userUID=uid-1"]);
    })();
  });
  it("falls back to the query when the direct probe is denied by rules", async () => {
    const db = fakeDb({ denyDirect: true, docs: { coaches: { c9: { userUID: "uid-1" } } } });
    expect((await findCoach(db, "uid-1"))?.id).toBe("c9");
  });
  it("returns null without a uid", async () => {
    expect(await findCoach(fakeDb(), null)).toBeNull();
  });
});

describe("findPlayer", () => {
  it("prefers authenticationUID, then userUID, then the own-id document", async () => {
    const byAuth = fakeDb({ docs: { players: { p1: { authenticationUID: "uid-1" }, p2: { userUID: "uid-1" } } } });
    expect((await findPlayer(byAuth, "uid-1"))?.id).toBe("p1");
    expect(byAuth.queries).toEqual(["players.authenticationUID=uid-1"]);

    const byUser = fakeDb({ docs: { players: { p2: { userUID: "uid-1" } } } });
    expect((await findPlayer(byUser, "uid-1"))?.id).toBe("p2");

    const byId = fakeDb({ docs: { players: { "uid-1": { firstName: "A" } } } });
    expect((await findPlayer(byId, "uid-1"))?.id).toBe("uid-1");
  });
  it("never resolves through signupEmail or legacy uid/authUID fields", async () => {
    const db = fakeDb({ docs: { players: { p3: { signupEmail: "a@b.c", uid: "uid-1", authUID: "uid-1" } } } });
    expect(await findPlayer(db, "uid-1")).toBeNull();
    expect(db.queries).toEqual(["players.authenticationUID=uid-1", "players.userUID=uid-1"]);
  });
  it("throws the repair message when a matched document has a conflicting owner field", async () => {
    const db = fakeDb({ docs: { players: { p1: { authenticationUID: "uid-1", userUID: "other" } } } });
    await expect(findPlayer(db, "uid-1")).rejects.toThrow("This athlete account needs its profile link repaired. Contact your coach.");
  });
  it("treats a denied own-document probe as no match", async () => {
    const db = fakeDb({ denyDirect: true, docs: { players: { "uid-1": { firstName: "A" } } } });
    expect(await findPlayer(db, "uid-1")).toBeNull();
  });
});
