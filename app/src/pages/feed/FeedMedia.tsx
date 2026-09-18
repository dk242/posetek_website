import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { auth } from '../../lib/firebase';
import { callSocialV2 } from './api';
import type { SocialActivity, SocialPoseOverlay, SocialViewer } from './contracts';
import { socialMediaLease } from './media-lease';
import { feedPlayback } from './media-playback';
import { footTrail, poseAtTime, poseConnections, validatedOverlay } from './pose-overlay';
import { NativeIcon } from '../athlete-portal/player/native-ui';
import wallPass from '../home/product/media/wall-pass.mp4';
import wallPassPoster from '../home/product/media/wall-pass.jpg';
import figureEight from '../home/product/media/figure-8.mp4';
import figureEightPoster from '../home/product/media/figure-8.jpg';

type Lease = { url: string; expiresAt: number; overlay: SocialPoseOverlay | null };
const stamp = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
function PoseOutline({ overlay, time, trails }: { overlay: SocialPoseOverlay; time: number; trails: boolean }) {
  const points = poseAtTime(overlay, time);
  if (!points) return null;
  const w = overlay.sourceWidth, h = overlay.sourceHeight;
  return <svg className="feed-pose-outline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    {trails && [overlay.footJoints.left, overlay.footJoints.right].map((joint, index) => <polyline key={joint} points={footTrail(overlay, time, joint).map(p => `${p[0] * w},${p[1] * h}`).join(' ')} fill="none" stroke={index ? '#20c8dc' : '#7cff18'} strokeWidth={4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" opacity=".75" />)}
    <g className="feed-pose-bones">{poseConnections[overlay.layout].map(([a,b]) => points[a] && points[b] ? <line key={`${a}-${b}`} x1={points[a]![0]*w} y1={points[a]![1]*h} x2={points[b]![0]*w} y2={points[b]![1]*h} stroke="#7cff18" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /> : null)}</g>
    {points.map((point,i) => point ? <circle key={i} cx={point[0]*w} cy={point[1]*h} r={Math.max(w,h)*.0045} fill="#f8fafc" stroke="#041610" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null)}
  </svg>;
}

/** Signed media is scoped to this card and viewer and never cached in a feed DTO. */
export default function FeedMedia({ activity, repId, viewer, preview }: { activity: SocialActivity; repId?: string; viewer: SocialViewer; preview: boolean }) {
  const id = useId(), region = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false), [lease, setLease] = useState<Lease | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true), [pausedByUser, setPausedByUser] = useState(false);
  const [time, setTime] = useState(0), [duration, setDuration] = useState(0), [aspect, setAspect] = useState(16/10);
  const [showPose, setShowPose] = useState(true), [trails, setTrails] = useState(true), [aligned, setAligned] = useState(false);
  const request = useRef(0), loading = useRef(false), failed = useRef(false), alive = useRef(false), isActive = useRef(false);
  const uid = auth.currentUser?.uid;
  const autoAllowed = useRef(true);
  const manualPlay = useRef(false);
  const pause = useCallback(() => { video.current?.pause(); setPlaying(false); }, []);
  const clear = useCallback(() => {
    ++request.current; loading.current = false; pause();
    if (video.current) { video.current.removeAttribute('src'); video.current.load(); }
    setLease(null); setBusy(false); setTime(0); setDuration(0); setAspect(16/10); setAligned(false);
  }, [pause]);
  useEffect(() => {
    alive.current = true;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    autoAllowed.current = !motion.matches && !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    const unregister = feedPlayback.register(id, value => { isActive.current = value; if (!value) { pause(); setMuted(true); manualPlay.current = false; } setActive(value); });
    const hide = () => { if (document.hidden) { feedPlayback.suspend(id); clear(); } };
    const leave = () => { feedPlayback.suspend(id); clear(); };
    window.addEventListener('posetek:player-route-leave', leave); window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hide);
    return () => {
      alive.current = false; unregister(); clear();
      window.removeEventListener('posetek:player-route-leave', leave); window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [id, clear, pause]);
  useEffect(() => {
    clear(); failed.current = false; manualPlay.current = false; setNotice(''); setMuted(true); setPausedByUser(false);
  }, [activity.id, activity.canViewVideo, activity.audience, activity.hidden, activity.selectedRepId, activity.poseOverlay, repId, uid, viewer.organizationId, viewer.viewAsPlayerId, clear]);
  useEffect(() => {
    const target = region.current; if (!target || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0];
      const eligible = entry.isIntersecting && entry.intersectionRatio >= .35 && !document.hidden;
      feedPlayback.update(id, entry.intersectionRect.width * entry.intersectionRect.height, eligible);
      if (!entry.isIntersecting) { failed.current = false; manualPlay.current = false; setPausedByUser(false); clear(); }
    }, { rootMargin: '-64px 0px -88px 0px', threshold: [0,.15,.35,.5,.65,.85,1] });
    observer.observe(target);
    const reveal = () => { if (!document.hidden) { observer.disconnect(); observer.observe(target); } };
    document.addEventListener('visibilitychange', reveal);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', reveal); };
  }, [id, clear]);
  const load = useCallback(async () => {
    if (loading.current || !activity.canViewVideo || document.hidden) return;
    const epoch = ++request.current; loading.current = true; setBusy(true); setNotice('');
    try {
      const response = preview
        ? { url: activity.id === 'sample-3' ? figureEight : wallPass, expiresAt: Date.now()+300_000, overlay: null }
        : await callSocialV2('getSocialMedia', { organizationId: viewer.organizationId, viewAsPlayerId: viewer.viewAsPlayerId, id: activity.id, ...(repId ? { repId } : {}), includeOverlay: true });
      if (!alive.current || epoch !== request.current || (!preview && uid !== auth.currentUser?.uid) || document.hidden || !isActive.current) return;
      // Bundled public demonstration clips are not signed links or athlete data.
      const valid = preview ? { url: response.url!, expiresAt: response.expiresAt! } : socialMediaLease(response);
      setLease(valid ? { ...valid, overlay: validatedOverlay(response.overlay) } : null);
      failed.current = !valid;
      if (!valid) setNotice('This saved video is no longer available.');
    } catch { if (alive.current && epoch === request.current) { failed.current = true; setNotice('Could not load this video. Tap to try again.'); } }
    finally { if (alive.current && epoch === request.current) { loading.current = false; setBusy(false); } }
  }, [activity.canViewVideo, activity.id, preview, viewer.organizationId, viewer.viewAsPlayerId, repId, uid]);
  useEffect(() => {
    if (!active) { pause(); return; }
    if (!lease && !busy && !failed.current && (autoAllowed.current || manualPlay.current) && !pausedByUser) { const timer = setTimeout(() => void load(), 150); return () => clearTimeout(timer); }
  }, [active, lease, busy, load, pause, pausedByUser]);
  useEffect(() => {
    const element = video.current;
    if (!element || !lease || !active || pausedByUser || (!autoAllowed.current && !manualPlay.current)) return;
    element.muted = muted;
    void element.play().catch(() => { if (alive.current) setPlaying(false); });
  }, [lease, active, pausedByUser, muted]);
  useEffect(() => {
    if (!lease) return;
    const timeout = setTimeout(() => { failed.current = true; clear(); setNotice('Video access expired. Tap to reload.'); }, Math.max(0, lease.expiresAt-Date.now()));
    return () => clearTimeout(timeout);
  }, [lease, clear]);
  useEffect(() => {
    const element = video.current;
    if (!element || !active || !playing) return;
    let handle = 0;
    const paint = () => { setTime(element.currentTime); handle = requestAnimationFrame(paint); };
    handle = requestAnimationFrame(paint); return () => cancelAnimationFrame(handle);
  }, [active, playing]);
  const toggle = () => {
    if (playing) { setPausedByUser(true); pause(); return; }
    failed.current = false; manualPlay.current = true; setPausedByUser(false); feedPlayback.activate(id);
    if (!lease) { void load(); return; }
    void video.current?.play().catch(() => setNotice('Tap play again to start this video.'));
  };
  const overlay = aligned ? lease?.overlay : null;
  return <div className="feed-media" ref={region} data-active={active || undefined}>
    <div className="feed-media-stage" style={{ aspectRatio: String(aspect) }}>
      {lease ? <video ref={video} src={lease.url} playsInline muted={muted} loop preload="metadata" aria-label={`Saved video: ${activity.title}`}
        onPlay={() => { if (!isActive.current || document.hidden) { video.current?.pause(); return; } setPlaying(true); }} onPause={() => setPlaying(false)}
        onLoadedMetadata={() => {
          const element = video.current; if (!element) return;
          setDuration(Number.isFinite(element.duration) ? element.duration : 0);
          if (element.videoWidth && element.videoHeight) {
            const ratio = element.videoWidth/element.videoHeight; setAspect(ratio);
            setAligned(!!lease.overlay && Number.isFinite(element.duration) && lease.overlay.frames.at(-1)!.time <= element.duration + .08 && Math.abs(ratio - lease.overlay.sourceWidth/lease.overlay.sourceHeight) <= ratio*.02);
          }
        }} onTimeUpdate={() => setTime(video.current?.currentTime || 0)} onError={() => { failed.current = true; clear(); setNotice('This video could not be played. Tap to retry.'); }} />
        : preview ? <img src={activity.id === 'sample-3' ? figureEightPoster : wallPassPoster} alt="Approved drill demonstration" /> : <div className="feed-media-placeholder"><NativeIcon name="video" size={36} /><span>Saved rep video</span></div>}
      {overlay && showPose && <PoseOutline overlay={overlay} time={time} trails={trails} />}
      <button className={`feed-media-play ${playing ? 'is-playing' : ''}`} aria-label={playing ? 'Pause video' : 'Play video'} onClick={toggle} disabled={busy}><NativeIcon name={playing ? 'pause' : 'play'} size={28} /></button>
      {busy && <span className="feed-media-loading" role="status">Loading video…</span>}
      <div className="feed-media-tools">
        {overlay && <button aria-pressed={showPose} aria-label="Show pose outline" onClick={() => setShowPose(v => !v)}><NativeIcon name="skeleton" size={18} />Pose</button>}
        {overlay && showPose && <button aria-pressed={trails} onClick={() => setTrails(v => !v)}>Foot trails</button>}
        <button aria-label={muted ? 'Unmute video' : 'Mute video'} aria-pressed={!muted} onClick={() => setMuted(v => !v)}><NativeIcon name={muted ? 'mute' : 'volume'} size={18} /></button>
      </div>
    </div>
    <div className="feed-media-progress"><span>{stamp(time)}</span><input type="range" aria-label="Video progress" min={0} max={duration || 1} step={.01} value={Math.min(time,duration || 1)} disabled={!lease || !duration} onChange={event => { const value = Number(event.target.value); if (video.current) video.current.currentTime = value; setTime(value); }} /><span>{stamp(duration)}</span></div>
    {overlay && overlay.markers.length > 0 && <div className="feed-pose-markers">{overlay.markers.map((marker,i) => <button key={i} onClick={() => { if (video.current) video.current.currentTime = marker.time; setTime(marker.time); }}>{marker.label}</button>)}</div>}
    {preview && <p className="feed-media-caption">Demonstration clip · sample activity figures</p>}
    {notice && <p className="feed-media-caption" role="status">{notice}</p>}
  </div>;
}
