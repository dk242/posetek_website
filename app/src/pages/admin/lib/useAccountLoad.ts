import { useEffect, useState } from "react";
import { auth } from "../../../lib/firebase";

export type AccountLoad<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string };

/** Every selection, retry and Auth change invalidates the previous response. */
export function useAccountLoad<T>(loader: () => Promise<T>) {
  const [result, setResult] = useState<{ loader: () => Promise<T>; revision: number; uid: string | null; state: AccountLoad<T> } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let generation = 0;
    const stop = auth.onAuthStateChanged(user => {
      const request = ++generation;
      const publish = (state: AccountLoad<T>) => setResult({ loader, revision, uid: user?.uid || null, state });
      publish({ kind: "loading" });
      if (!user) return;
      const uid = user.uid;
      const current = () => request === generation && auth.currentUser?.uid === uid;
      loader().then(data => { if (current()) publish({ kind: "ready", data }); })
        .catch(error => { if (current()) publish({ kind: "error", message: error instanceof Error ? error.message : "These accounts could not be loaded." }); });
    });
    return () => { ++generation; stop(); };
  }, [loader, revision]);
  const state: AccountLoad<T> = result?.loader === loader && result.revision === revision && result.uid === auth.currentUser?.uid ? result.state : { kind: "loading" };
  return { state, refresh: () => setRevision(value => value + 1) };
}
