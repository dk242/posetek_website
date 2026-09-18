import { useEffect, useState } from 'react';
import { db, storage } from '../../../lib/firebase';
import { normalizeCatalogDrill } from '../../../lib/contracts/drillV2';
import { MEDIA_SLOTS, MEDIA_SLOT_LABELS } from '../../../lib/contracts/types';
import type { Row } from './execution';

// Generic published instructions only; never cache athlete media or personal data.
const instructionCache = new Map<string, Row>();
export default function DrillMedia({ drillId, preview = false, onChat, fallback }: { drillId: string; preview?: boolean; onChat?: (text: string) => void; fallback?: Row }) {
  const [drill, setDrill] = useState<Row | null>(null), [media, setMedia] = useState<Row[]>([]);
  const [active, setActive] = useState(0), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true, generation = 0;
    setError(''); setDrill(instructionCache.get(drillId) || null); setMedia([]); setActive(0);
    if (preview) { setDrill({ name: drillId, howTo: { setup: 'Find an open space and place your cones.', steps: ['Move with control.', 'Keep your head up and repeat the prescribed sets.'] }, coachComments: ['Quality before speed.'], equipment: ['ball', 'cones'] }); return; }
    // Snapshot refreshes media when an instructor publishes a replacement.
    const stop = db.collection('drillCatalog').doc(drillId).onSnapshot(async doc => {
      if (!alive) return;
      const token = ++generation;
      setMedia([]); setActive(0);
      if (!doc.exists) { instructionCache.delete(drillId); setDrill(null); setError('The demonstration is not available yet. Follow the workout cues.'); return; }
      const catalog = normalizeCatalogDrill(doc.id, doc.data()); setDrill(catalog);
      instructionCache.delete(drillId); instructionCache.set(drillId, catalog);
      if (instructionCache.size > 40) instructionCache.delete(instructionCache.keys().next().value!);
      const assets = await Promise.all(MEDIA_SLOTS.map(async slot => {
        const item = catalog.media?.[slot];
        if (!item?.storagePath || (item.status && item.status !== 'approved')) return null;
        try { return { slot, url: await storage.ref(item.storagePath).getDownloadURL(), contentType: item.contentType || '', generation: item.generation }; }
        catch { return { slot, error: 'This video could not be loaded. Try again later.' }; }
      }));
      if (alive && token === generation) { setMedia(assets.filter(Boolean) as Row[]); setActive(0); }
    }, () => { if (alive) { generation++; setMedia([]); setError('Instructions could not be refreshed. Check your connection and retry.'); } });
    return () => { alive = false; stop(); };
  }, [drillId, preview, retry]);
  const asset = media[active];
  return <section className="portal-card player-drill-media">
    <h3>How to do it</h3>
    {!!media.length && <><div className="player-actions" role="tablist" aria-label="Drill demonstrations">{media.map((m, i) => <button key={m.slot} role="tab" aria-selected={i === active} onClick={() => setActive(i)}>{MEDIA_SLOT_LABELS[m.slot as keyof typeof MEDIA_SLOT_LABELS]}</button>)}</div>
      {asset?.error ? <p role="status">{asset.error} <button onClick={() => setRetry(n => n + 1)}>Retry media</button></p> : asset?.contentType.startsWith('image/') ? <img src={asset.url} alt={`${drill?.name} demonstration`} /> : asset && <video key={`${asset.url}:${asset.generation}`} src={asset.url} controls playsInline preload="metadata" onError={() => setMedia(rows => rows.map((m, i) => i === active ? { ...m, error: 'This video could not be played. Your instructions and workout remain available.' } : m))} />}</>}
    {error && <p role="status">{error} {drill && 'Showing the instructions already loaded for this drill.'} <button onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {!drill && !error && <p>Loading instructions…</p>}
    {drill && <>{!media.length && <p className="muted-copy">{error ? 'Demonstration media is unavailable. Your loaded instructions remain below.' : 'No demonstration video available yet.'}</p>}<p>{drill.howTo?.setup}</p><ol>{drill.howTo?.steps?.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
      {!!drill.coachComments?.length && <ul>{drill.coachComments.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}
      <p className="muted-copy">Equipment: {drill.equipment?.join(', ') || 'See setup'}</p></>}
    {!drill && fallback && <><p>Follow the saved prescription for {fallback.name || drillId}.</p>{fallback.cues?.length > 0 && <ul>{fallback.cues.map((cue: string, i: number) => <li key={i}>{cue}</li>)}</ul>}</>}
    {onChat && <button className="hub-secondary" onClick={() => onChat(`Help me with ${drill?.name || drillId}. Setup: ${drill?.howTo?.setup || ''}. Steps: ${(drill?.howTo?.steps || []).join(' ')}`)}>Ask about this drill</button>}
  </section>;
}
