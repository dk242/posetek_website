import { useEffect } from 'react';
import { auth, cloud } from '../firebase';
import { featureForLocation } from './clock';
import { browserUsageLocks, removeOtherActorQueues, UsageQueue } from './queue';
import type { UsageStorage } from './queue';
import { createUsageSession } from './session';

const BUILD = 'web-insights-v2';

// Mounted once in the authenticated application's router. Public marketing
// assets remain unchanged. No UID, URL, or selected player enters a payload.
export default function UsageTracking() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let epoch = 0;
    const stopAuth = auth.onAuthStateChanged(async user => {
      const ownEpoch = ++epoch; cleanup?.(); cleanup = undefined;
      let storage: UsageStorage | undefined;
      try { storage = localStorage; } catch { /* Optional browser storage. */ }
      removeOtherActorQueues(storage, user && !user.isAnonymous ? user.uid : null);
      if (!user || user.isAnonymous) return;
      let context: any;
      try { context = (await cloud.httpsCallable('getClubContext')({})).data; } catch { return; }
      if (epoch !== ownEpoch || auth.currentUser?.uid !== user.uid) return;
      if (context?.role !== 'player') { removeOtherActorQueues(storage, null); return; }
      // A new instance ID avoids the copied sessionStorage ID in duplicated tabs.
      const queue = new UsageQueue(user.uid, crypto.randomUUID(), storage, browserUsageLocks(), Date.now);
      const videoPositions = new WeakMap<HTMLVideoElement, number>();
      const session = createUsageSession({
        uid: user.uid, sessionId: crypto.randomUUID(), build: BUILD, queue,
        invoke: async batch => (await cloud.httpsCallable('recordInsightUsage')(batch)).data as { accepted?: boolean; reason?: string },
        environment: {
          wall: Date.now, mono: () => performance.now(), currentUid: () => auth.currentUser?.uid,
          online: () => navigator.onLine,
          visible: () => document.visibilityState === 'visible' && document.hasFocus(),
          feature: () => featureForLocation(location.pathname, location.search),
          progressingVideo: () => {
            let progressing = false;
            for (const video of document.querySelectorAll('video')) {
              const prior = videoPositions.get(video); videoPositions.set(video, video.currentTime);
              const rect = video.getBoundingClientRect();
              if (!video.paused && !video.ended && !video.seeking && prior !== undefined && video.currentTime > prior && video.currentTime - prior < 2
                && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) progressing = true;
            }
            return progressing;
          },
          on: (name, listener) => {
            const callback = (event: Event) => listener({ isTrusted: event.isTrusted, detail: (event as CustomEvent).detail });
            const target = name === 'visibilitychange' ? document : window;
            target.addEventListener(name, callback, { passive: true, capture: true });
            return () => target.removeEventListener(name, callback, true);
          },
          every: (milliseconds, action) => { const id = setInterval(action, milliseconds); return () => clearInterval(id); },
        },
      });
      cleanup = session.close;
      await session.start();
    });
    return () => { epoch++; stopAuth(); cleanup?.(); };
  }, []);
  return null;
}
