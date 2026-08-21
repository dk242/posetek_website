/* eslint-disable @typescript-eslint/no-explicit-any */
// Pure roster helpers ported verbatim from coach-roster.js (coachesview.html).
// Behavior parity is the contract: keep field fallbacks, strict-equality checks,
// separators (middle dot in the summary), and the "PLR" code alphabet identical.

export function initials(player: any): string {
  return `${player.firstName?.[0] || ""}${player.lastName?.[0] || ""}`.toUpperCase() || "A";
}

export function fullName(player: any): string {
  return [player.firstName, player.lastName].filter(Boolean).join(" ") || player.name || "Athlete";
}

// Legacy makeCode(): "PLR" + 4 chars from an alphabet that omits I, O, 0, 1.
export function makeCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "PLR";
  for (let i = 0; i < 4; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// Legacy chip condition: player.registered===true || Boolean(player.userUID)
export function isRegistered(player: any): boolean {
  return player.registered === true || Boolean(player.userUID);
}

// Legacy pending count: players.filter(p => !(p.registered===true || p.userUID)).length
export function pendingCount(players: any[]): number {
  return players.filter(player => !(player.registered === true || player.userUID)).length;
}

export function summaryText(players: any[]): string {
  return `${players.length} ${players.length === 1 ? "player" : "players"} · ${pendingCount(players)} awaiting signup`;
}

// Legacy search filter: matches full name OR player.code (NOT signupCode).
export function filterPlayers(players: any[], query: string): any[] {
  const needle = query.trim().toLowerCase();
  return players.filter(
    player =>
      fullName(player).toLowerCase().includes(needle) ||
      (player.code || "").toLowerCase().includes(needle),
  );
}

export function sortByName(players: any[]): any[] {
  return players.sort((a, b) => fullName(a).localeCompare(fullName(b)));
}
