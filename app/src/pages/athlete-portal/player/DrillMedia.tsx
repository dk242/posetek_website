import { useEffect, useState } from 'react';
import { db, storage } from '../../../lib/firebase';
import { normalizeCatalogDrill } from '../../../lib/contracts/drillV2';
import { MEDIA_SLOTS, MEDIA_SLOT_LABELS } from '../../../lib/contracts/types';
import type { Row } from './execution';

export default function DrillMedia({ drillId, preview = false, onChat }: { drillId: string; preview?: boolean; onChat?: (text: string) => void }) {
  const [drill, setDrill] = useState<Row | null>(null), [media, setMedia] = useState<Row[]>([]);
  const [active, setActive] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    let alive = true, generation = 0;
    setError(''); setDrill(null); setMedia([]); setActive(0);
    if (preview) { setDrill({ name: drillId, howTo: { setup: 'Find an open space and place your cones.', steps: ['Move with control.', 'Keep your head up and repeat the prescribed sets.'] }, coachComments: ['Quality before speed.'], equipment: ['ball', 'cones'] }); return; }
    // Snapshot refreshes media when an instructor publishes a replacement.
    const stop = db.collection('drillCatalog').doc(drillId).onSnapshot(async doc => {
      if (!alive) return;
      const token = ++generation;
      if (!doc.exists) { setError('The demonstration is not available yet. Follow the workout cues.'); return; }
      const catalog = normalizeCatalogDrill(doc.id, doc.data()); setDrill(catalog);
      const assets = await Promise.all(MEDIA_SLOTS.map(async slot => {
        const item = catalog.media?.[slot];
        if (!item?.storagePath || (item.status && item.status !== 'approved')) return null;
        try { return { slot, url: await storage.ref(item.storagePath).getDownloadURL(), contentType: item.contentType || '', generation: item.generation }; }
        catch { return { slot, error: 'This video could not be loaded. Try again later.' }; }
      }));
      if (alive && token === generation) { setMedia(assets.filter(Boolean) as Row[]); setActive(0); }
    }, e => { if (alive) setError(e.message); });
    return () => { alive = false; stop(); };
  }, [drillId, preview]);
  const asset = media[active];
  return <section className="portal-card player-drill-media">
    <h3>How to do it</h3>
    {!!media.length && <><div className="player-actions" role="tablist" aria-label="Drill demonstrations">{media.map((m, i) => <button key={m.slot} role="tab" aria-selected={i === active} onClick={() => setActive(i)}>{MEDIA_SLOT_LABELS[m.slot as keyof typeof MEDIA_SLOT_LABELS]}</button>)}</div>
      {asset?.error ? <p role="status">{asset.error}</p> : asset?.contentType.startsWith('image/') ? <img src={asset.url} alt={`${drill?.name} demonstration`} /> : asset && <video key={`${asset.url}:${asset.generation}`} src={asset.url} controls playsInline preload="metadata" />}</>}
    {error && <p role="status">{error}</p>}
    {!drill && !error && <p>Loading instructions…</p>}
    {drill && <>{!media.length && <p className="muted-copy">No demonstration video published yet.</p>}<p>{drill.howTo?.setup}</p><ol>{drill.howTo?.steps?.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
      {!!drill.coachComments?.length && <ul>{drill.coachComments.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}
      <p className="muted-copy">Equipment: {drill.equipment?.join(', ') || 'See setup'}</p></>}
    {onChat && <button className="hub-secondary" onClick={() => onChat(`Help me with ${drill?.name || drillId}. Setup: ${drill?.howTo?.setup || ''}. Steps: ${(drill?.howTo?.steps || []).join(' ')}`)}>Ask about this drill</button>}
  </section>;
}
