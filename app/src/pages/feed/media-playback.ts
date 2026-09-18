/** One active clip per visible feed. A small lead avoids flicker at card borders. */
export function createPlaybackCoordinator() {
  const entries = new Map<string, { area: number; eligible: boolean; change(active: boolean): void }>();
  let current: string | null = null;
  const choose = (forced?: string) => {
    let winner: string | null = forced && entries.get(forced)?.eligible ? forced : null;
    if (!winner) {
      const sorted = [...entries].filter(([, entry]) => entry.eligible && entry.area > 0).sort((a, b) => b[1].area - a[1].area);
      winner = sorted[0]?.[0] || null;
      const previous = current ? entries.get(current) : undefined;
      if (previous?.eligible && winner && entries.get(winner)!.area < previous.area * 1.15) winner = current;
    }
    if (winner === current) return;
    if (current) entries.get(current)?.change(false);
    current = winner;
    if (current) entries.get(current)?.change(true);
  };
  return {
    register(id: string, change: (active: boolean) => void) {
      entries.set(id, { area: 0, eligible: false, change });
      return () => { if (current === id) { change(false); current = null; } entries.delete(id); choose(); };
    },
    update(id: string, area: number, eligible: boolean) {
      const entry = entries.get(id); if (!entry) return;
      entry.area = Math.max(0, Number.isFinite(area) ? area : 0); entry.eligible = eligible; choose();
    },
    activate(id: string) { const entry = entries.get(id); if (entry) { entry.eligible = true; entry.area = Math.max(entry.area, 1); choose(id); } },
    suspend(id: string) { const entry = entries.get(id); if (entry) { entry.eligible = false; choose(); } },
    current: () => current,
  };
}
export const feedPlayback = createPlaybackCoordinator();
