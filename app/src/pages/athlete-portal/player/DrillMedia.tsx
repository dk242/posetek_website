import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { db, storage } from '../../../lib/firebase';
import { normalizeCatalogDrill } from '../../../lib/contracts/drillV2';
import { MEDIA_SLOTS, MEDIA_SLOT_LABELS } from '../../../lib/contracts/types';
import type { Row } from './execution';
import { NativeIcon } from './native-ui';
import './native-training.css';

// Generic published instructions only; never cache athlete media or personal data.
const instructionCache = new Map<string, Row>();
export default function DrillMedia({ drillId, preview = false, onChat, onInstructions, fallback, children }: { drillId: string; preview?: boolean; onChat?: (text: string) => void; onInstructions?: () => void; fallback?: Row; children?: (media: ReactNode, instructions: ReactNode) => ReactNode }) {
  const [drill, setDrill] = useState<Row | null>(null), [media, setMedia] = useState<Row[]>([]);
  const [active, setActive] = useState(0), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [aspect, setAspect] = useState(1.6);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const stop = () => video.current?.pause();
    const visibility = () => { if (document.hidden) stop(); };
    window.addEventListener('posetek:player-route-leave', stop); window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', visibility);
    return () => { stop(); window.removeEventListener('posetek:player-route-leave', stop); window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { setAspect(1.6); }, [active, drillId]);
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
      if (alive && token === generation) { const available = assets.filter(Boolean) as Row[]; setMedia(available); setActive(available.some(m => m.slot === 'primaryDemo') ? 1 : 0); }
    }, () => { if (alive) { generation++; setMedia([]); setError('Instructions could not be refreshed. Check your connection and retry.'); } });
    return () => { alive = false; stop(); };
  }, [drillId, preview, retry]);
  const overview = media.find(m => m.slot === 'birdsEye');
  const panes: Row[] = [overview || { slot: 'overview' }, ...media.filter(m => m.slot !== 'birdsEye')];
  const asset = panes[active] || panes[0];
  const name = fallback?.name || drill?.name || drillId;
  const cues = drill?.coachComments?.length ? drill.coachComments : fallback?.cues || [];
  const mediaPanel = <section className="native-drill-media" aria-label={`${name} demonstration`}>
    <div className={`native-media-pane ${!asset?.url ? 'is-overview' : ''}`} style={{ aspectRatio: String(aspect < 1 ? 1 : Math.max(4 / 3, Math.min(2, aspect))) }}>
      {asset?.error ? <div className="native-media-overview" role="status"><NativeIcon name="video" size={28} /><h3>Keep training with the instructions</h3><p>{asset.error}</p><button onClick={() => setRetry(n => n + 1)}>Retry media</button></div> : !asset?.url ? <div className="native-media-overview"><NativeIcon name="setup" size={30} /><span className="eyebrow">Overview</span><h3>{name}</h3><p>{drill?.howTo?.setup || (drill ? 'Follow the dose and coaching cues below.' : error ? 'Follow your saved workout cues below.' : 'Loading setup…')}</p>{drill?.equipment?.length > 0 && <small>{drill?.equipment.join(' · ')}</small>}</div> : asset.contentType.startsWith('image/') ? <img src={asset.url} alt={`${name} demonstration`} onLoad={e => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} /> : <video ref={video} key={`${asset.url}:${asset.generation}`} src={asset.url} controls muted loop playsInline preload="metadata" onLoadedData={e => { if (!document.hidden && e.currentTarget.getClientRects().length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) void e.currentTarget.play().catch(() => {}); }} onLoadedMetadata={e => setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)} onError={() => setMedia(rows => rows.map(m => m.slot === asset.slot ? { ...m, error: 'This demonstration could not be played. Your instructions and workout remain available.' } : m))} />}
    </div>
    {panes.length > 1 && <div className="native-media-tabs" aria-label="Drill demonstrations">{panes.map((m, i) => <button key={m.slot} aria-pressed={i === active} onClick={() => { video.current?.pause(); setActive(i); }}>{m.slot === 'overview' || m.slot === 'birdsEye' ? 'Overview' : MEDIA_SLOT_LABELS[m.slot as keyof typeof MEDIA_SLOT_LABELS]}</button>)}</div>}
  </section>;
  const instructions = <section className="portal-card native-drill-about"><p className="eyebrow">About this drill</p>
    {fallback?.whyIncluded && <p className="muted-copy">{fallback.whyIncluded}</p>}
    {error && <p role="status">{error} <button onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {!drill && !error && <p>Loading instructions…</p>}
    {drill?.howTo?.setup && <div className="native-teaching-row"><span className="native-domain-badge"><NativeIcon name="setup" size={14} /></span><div><small>Set up</small><p>{drill.howTo.setup}</p></div></div>}
    {drill?.howTo?.steps?.map((step: string, i: number) => <div className="native-teaching-row" key={i}><span className="native-domain-badge"><NativeIcon name="run" size={14} /></span><div><small>Step {i + 1}</small><p>{step}</p></div></div>)}
    {cues.map((cue: string, i: number) => <p className="native-cue" key={i}><NativeIcon name="check-circle" size={16} /><span>{cue}</span></p>)}
    {drill?.equipment?.length > 0 && <p className="muted-copy">Equipment: {drill?.equipment.join(', ')}</p>}
    {(onChat || onInstructions) && <div className="native-about-actions">{onInstructions && <button className="native-full-instructions" onClick={onInstructions}>Full instructions<NativeIcon name="chevron-right" size={12} /></button>}{onChat && <button className="hub-secondary" onClick={() => onChat(`Help me with ${name}. Setup: ${drill?.howTo?.setup || ''}. Steps: ${(drill?.howTo?.steps || []).join(' ')}`)}><NativeIcon name="chat" size={14} /> Ask about this drill</button>}</div>}
  </section>;
  return children ? <>{children(mediaPanel, instructions)}</> : <div className="player-drill-media native-drill-detail">{mediaPanel}{instructions}</div>;
}
