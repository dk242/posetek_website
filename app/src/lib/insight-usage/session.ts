import { EngagementClock, appendInterval } from './clock';
import type { UsageBatch, UsageFeature, UsageInterval } from './clock';
import { UsageDelivery, UsageQueue } from './queue';

type Signal = { isTrusted?: boolean; detail?: { active?: boolean } };
export interface UsageEnvironment {
  wall(): number;
  mono(): number;
  currentUid(): string | undefined;
  online(): boolean;
  visible(): boolean;
  feature(): UsageFeature | null;
  progressingVideo(): boolean;
  on(name: string, listener: (event: Signal) => void): () => void;
  every(milliseconds: number, action: () => void): () => void;
}

// The same lifecycle is used by the browser adapter and deterministic tests.
// close() is available before asynchronous queue recovery, so an auth switch
// cannot install late listeners or persist an old actor's acknowledged queue.
export function createUsageSession(options: {
  uid: string; sessionId: string; build: string; queue: UsageQueue; environment: UsageEnvironment;
  invoke(batch: UsageBatch): Promise<{ accepted?: boolean; reason?: string }>;
}) {
  const { uid, sessionId, build, queue, environment: env, invoke } = options;
  const clock = new EngagementClock(env.mono(), env.wall());
  let pending: UsageInterval[] = [], sequence = 0, closed = false;
  const stops: (() => void)[] = [];
  const delivery = new UsageDelivery(uid, queue, env.currentUid, env.online, env.wall, invoke, () => { pending = []; });
  const eligible = () => !closed && delivery.active && env.currentUid() === uid;
  const enqueue = () => {
    if (!eligible() || !pending.length) return;
    queue.append({ schemaVersion: 1, sessionId, sequence: sequence++, platform: 'web', build, intervals: pending });
    pending = [];
  };
  const sample = () => {
    const wall = env.wall(), rows = clock.sample(env.mono(), wall);
    if (eligible() && wall >= delivery.disabledUntil) {
      for (const row of rows) {
        pending = appendInterval(pending, row);
        if (pending.length >= 60) enqueue();
      }
    }
    clock.configure(eligible() && env.visible(), env.feature());
  };
  const send = () => { void delivery.send(); };
  return {
    async start() {
      await queue.start();
      if (!eligible()) { queue.close(); return; }
      // Recovery latency is not engagement time.
      sample(); clock.configure(env.visible(), env.feature());
      for (const name of ['pointerdown', 'keydown', 'touchstart', 'scroll']) stops.push(env.on(name, event => {
        if (event.isTrusted && eligible()) { sample(); clock.interact(env.mono()); }
      }));
      for (const name of ['visibilitychange', 'blur', 'focus', 'pagehide']) stops.push(env.on(name, () => {
        sample(); clock.stopProgress(); enqueue(); send();
      }));
      stops.push(env.on('posetek:usage-workout', event => {
        if (eligible() && env.visible() && env.feature() && event.detail?.active === true) clock.progress('workout', env.mono());
        else clock.stopProgress('workout');
      }));
      stops.push(env.on('online', send));
      stops.push(env.every(1000, () => {
        if (eligible() && env.visible() && env.progressingVideo()) clock.progress('video', env.mono());
        sample(); send();
      }));
      stops.push(env.every(30000, () => { enqueue(); send(); }));
      stops.push(env.every(60000, () => {
        if (eligible() && env.wall() >= delivery.disabledUntil) void queue.recover().then(send);
      }));
      send();
    },
    close() {
      if (closed) return;
      sample(); enqueue(); closed = true;
      delivery.close(); stops.forEach(stop => stop()); queue.close();
    },
  };
}
