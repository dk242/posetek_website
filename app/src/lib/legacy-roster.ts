// Historical coach rosters may retain references to players moved into a club.
// Only a per-player permission/not-found rejection is an expected omission;
// network, session and service failures still make the refresh fail visibly.
export async function readAccessibleLegacyRoster<T>(ids: readonly string[], read: (id: string) => Promise<T>): Promise<T[]> {
  const results = await Promise.all(ids.map(async id => {
    try { return { value: await read(id) }; }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "permission-denied" || code === "not-found" || code === "firestore/permission-denied" || code === "firestore/not-found") return null;
      throw error;
    }
  }));
  return results.flatMap(result => result ? [result.value] : []);
}
