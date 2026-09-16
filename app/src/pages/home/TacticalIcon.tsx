type IconKind = "play" | "pause" | "previous" | "next" | "explore" | "gate" | "cut" | "control" | "compare" | "retest";
/** Small field-diagram icons, independent of platform emoji fonts. */
export function TacticalIcon({ kind }: { kind: IconKind }) {
  return <svg className={`tactical-icon tactical-icon-${kind}`} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === "play" && <><circle cx="16" cy="16" r="12" opacity=".45"/><path d="m13 10 9 6-9 6z" fill="currentColor" stroke="none"/></>}
    {kind === "pause" && <><circle cx="16" cy="16" r="12" opacity=".45"/><path d="M12 11v10M20 11v10" strokeWidth="3"/></>}
    {(kind === "previous" || kind === "next") && <path d={kind === "previous" ? "m19 9-7 7 7 7" : "m13 9 7 7-7 7"}/>}
    {kind === "explore" && <><path d="M10 4H4v6M22 4h6v6M4 22v6h6M28 22v6h-6" opacity=".5"/><circle cx="16" cy="16" r="5"/><path d="M16 9v-3M16 23v3M9 16H6M23 16h3"/></>}
    {kind === "gate" && <><path d="M5 8h10q5 0 5 5v8"/><path d="M13 27V17M27 27V17" opacity=".6"/><circle cx="20" cy="25" r="2" fill="currentColor"/></>}
    {kind === "cut" && <><path d="m4 26 9-16 8 10 7-15M23 5h5v5"/><path d="m7 18 3 5H4zM20 24l3 5h-6z" opacity=".5"/></>}
    {kind === "compare" && <><rect x="5" y="6" width="22" height="20" rx="2"/><path d="M16 6v20M9 12h3M20 20h3"/></>}
    {kind === "control" && <><rect x="3" y="5" width="26" height="22" rx="3" opacity=".35"/><path d="M16 16c-11-15-15 15 0 0s15 15 0 0"/><circle cx="16" cy="16" r="2" fill="currentColor"/></>}
    {kind === "retest" && <><path d="M25 12a10 10 0 1 0 0 9M25 5v7h-7"/><path d="m13 12 6 4-6 4z" fill="currentColor" stroke="none"/></>}
  </svg>;
}
