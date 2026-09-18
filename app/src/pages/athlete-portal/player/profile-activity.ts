import type { Row } from './execution';

const names: Record<string, string> = { shooting: 'Shooting', sprint: 'Sprint', jump: 'Jump', broadJump: 'Broad jump', changeOfDirection: 'Agility', dribbling: 'Dribbling', freeRecord: 'Free record' };
export function sessionDrill(value: unknown): string {
  const key = String(value || '').trim().toLowerCase().replace(/[ _-]/g, '');
  return ({ deadballshot: 'shooting', sidekick: 'shooting', broadjump: 'broadJump', changeofdirection: 'changeOfDirection', shuttle: 'changeOfDirection', agility: 'changeOfDirection', freerecord: 'freeRecord' } as Record<string, string>)[key] || key;
}
function sessionTime(row: Row): number | null {
  for (const value of [row.timestamp, row.createdAt, row.date, row.startedAt, row.createdAtMillis]) {
    if (value == null || value === '' || typeof value === 'boolean' || !['object', 'string', 'number'].includes(typeof value)) continue;
    const date = value?.toDate?.() ?? (typeof value === 'object' && Number.isFinite(value.seconds) ? new Date(value.seconds * 1000) : new Date(value));
    if (Number.isFinite(date.getTime())) return date.getTime();
  }
  // Legacy recordings store a local calendar date and time, without an offset.
  if (typeof row.currentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.currentDate)) {
    const date = new Date(`${row.currentDate}T${typeof row.currentTime === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(row.currentTime) ? row.currentTime : '00:00:00'}`);
    if (Number.isFinite(date.getTime())) return date.getTime();
  }
  return null;
}
export type ProfileSession = { id: string; drill: string; folder: string | null; time: number | null; repCount: number };
export function normalizeProfileSession(row: Row, legacy = false): ProfileSession | null {
  const drill = sessionDrill(row.sessionType || row.drillType || row.type);
  if (!drill || !row.id) return null;
  const rawFolder = row.storageFolderName || row.sessionFolder || row.currentSession || (Number.isInteger(row.sessionNumber) ? `session${row.sessionNumber}` : '');
  const number = typeof rawFolder === 'string' ? rawFolder.match(/(?:^|\/)session[ _-]*(\d+)(?:\/|$)/i)?.[1] : null;
  const fields = legacy ? ['numberReps', 'numberKicks', 'kickCount', 'repCount', 'numReps', 'numKicks', 'kicks', 'reps'] : ['repCount'];
  const count = fields.map(field => row[field]).find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return { id: String(row.id), drill, folder: number ? `session${Number(number)}` : null, time: sessionTime(row), repCount: Math.max(1, Math.floor(count || 0)) };
}
/** Prefer the current session document for a proven same-drill/folder legacy mirror.
 * Folder numbers alone never collapse two different drills. Rows without identity
 * evidence remain separate; neither measurements nor result qualification changes. */
export function mergeProfileSessions(current: Row[], legacy: Row[]): ProfileSession[] {
  const rows = new Map<string, ProfileSession>();
  const currentFolders = new Set<string>();
  for (const row of current) {
    const parsed = normalizeProfileSession(row); if (!parsed) continue;
    rows.set(`current:${parsed.id}`, parsed);
    if (parsed.folder) currentFolders.add(`${parsed.drill}:${parsed.folder}`);
  }
  const legacyFolders = new Map<string, ProfileSession>();
  for (const row of legacy) {
    const parsed = normalizeProfileSession(row, true); if (!parsed) continue;
    const key = parsed.folder ? `${parsed.drill}:${parsed.folder}` : `id:${parsed.id}`;
    if (currentFolders.has(key)) continue;
    const previous = legacyFolders.get(key);
    if (!previous || (parsed.time ?? -Infinity) > (previous.time ?? -Infinity)) legacyFolders.set(key, parsed);
  }
  for (const [key, value] of legacyFolders) rows.set(`legacy:${key}`, value);
  return [...rows.values()];
}
export function profileActivity(sessions: ProfileSession[], now = new Date()) {
  const day = (time: number) => { const date = new Date(time); return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); };
  const today = day(now.getTime()), days = new Set(sessions.filter(s => s.time !== null && s.time <= now.getTime()).map(s => day(s.time!)));
  const cursor = new Date(today); let streak = 0;
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.getTime())) { streak++; cursor.setDate(cursor.getDate() - 1); }
  const counts = new Map<string, number>();
  sessions.forEach(s => counts.set(s.drill, (counts.get(s.drill) || 0) + s.repCount));
  const favorite = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const favoriteName = favorite ? names[favorite[0]] || favorite[0].charAt(0).toUpperCase() + favorite[0].slice(1) : '—';
  return { streak, totalSessions: sessions.length, favoriteName, favoriteReps: favorite?.[1] || 0 };
}
