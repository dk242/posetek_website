import { useEffect, useRef, useState } from 'react';

export type WakeLockState = 'unsupported' | 'off' | 'waiting' | 'active' | 'unavailable';
export type ScreenLock = { released: boolean; release: () => Promise<void>; addEventListener: (type: 'release', listener: () => void, options?: AddEventListenerOptions) => void };

// Small controller so hidden-page, OS rejection and late-request behavior can be
// tested without relying on a particular browser's power settings.
export function createWorkoutWakeLock(request: (() => Promise<ScreenLock>) | undefined, report: (state: WakeLockState) => void) {
  let wanted = false, visible = true, disposed = false, version = 0;
  let sentinel: ScreenLock | null = null;
  const release = (lock: ScreenLock | null) => { if (lock && !lock.released) void lock.release().catch(() => {}); };
  const sync = () => {
    const token = ++version;
    release(sentinel); sentinel = null;
    if (disposed) return;
    if (!request) { report('unsupported'); return; }
    if (!wanted || !visible) { report(wanted ? 'waiting' : 'off'); return; }
    report('waiting');
    void request().then(lock => {
      if (disposed || version !== token || !wanted || !visible) { release(lock); return; }
      if (lock.released) { report('unavailable'); return; }
      sentinel = lock; report('active');
      lock.addEventListener('release', () => {
        if (sentinel !== lock || disposed) return;
        sentinel = null;
        // A power-saving rejection must not cause an automatic retry loop.
        report(wanted && visible ? 'unavailable' : wanted ? 'waiting' : 'off');
      }, { once: true });
    }).catch(() => { if (!disposed && version === token) report('unavailable'); });
  };
  return {
    update(nextWanted: boolean, nextVisible: boolean) {
      if (wanted === nextWanted && visible === nextVisible) return;
      wanted = nextWanted; visible = nextVisible; sync();
    },
    retry: sync,
    dispose() { disposed = true; ++version; release(sentinel); sentinel = null; },
  };
}

export function useWorkoutWakeLock(active: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<WakeLockState>(() => typeof navigator !== 'undefined' && navigator.wakeLock ? 'off' : 'unsupported');
  const controller = useRef<ReturnType<typeof createWorkoutWakeLock> | null>(null);
  const activity = useRef(active && enabled);
  useEffect(() => {
    const api = typeof navigator !== 'undefined' ? navigator.wakeLock : undefined;
    const handle = createWorkoutWakeLock(api ? () => api.request('screen') : undefined, setState);
    controller.current = handle;
    const sync = () => handle.update(activity.current, document.visibilityState === 'visible');
    const hide = () => handle.update(activity.current, false);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pageshow', sync);
    window.addEventListener('pagehide', hide);
    sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pageshow', sync);
      window.removeEventListener('pagehide', hide);
      handle.dispose(); controller.current = null;
    };
  }, []);
  useEffect(() => { activity.current = active && enabled; controller.current?.update(activity.current, document.visibilityState === 'visible'); }, [active, enabled]);
  return { enabled, setEnabled, state, retry: () => controller.current?.retry() };
}
