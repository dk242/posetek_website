/** A signed link is a short-lived capability, never a persistent card field. */
export function socialMediaLease(value: { url: string | null; expiresAt: number | null }, now = Date.now()) {
  if (!value.url || !Number.isFinite(value.expiresAt) || Number(value.expiresAt) <= now) return null;
  try { if (new URL(value.url).protocol !== 'https:') return null; } catch { return null; }
  return { url: value.url, expiresAt: Math.min(Number(value.expiresAt), now + 300_000) };
}
