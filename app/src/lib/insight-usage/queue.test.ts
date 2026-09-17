import { afterEach, describe, expect, it } from 'vitest';
import type { UsageBatch, UsageFeature } from './clock';
import { STORE_PREFIX, UsageDelivery, UsageQueue, removeOtherActorQueues } from './queue';
import type { UsageLocks, UsageStorage } from './queue';
import { createUsageSession } from './session';
import type { UsageEnvironment } from './session';

const NOW = 1_800_000_000_000;
const batch = (sequence = 0): UsageBatch => ({ schemaVersion: 1, platform: 'web', build: 'web-test',
  sessionId: '00000000-0000-4000-8000-000000000001', sequence,
  intervals: [{ startedAtMillis: NOW - 2000, endedAtMillis: NOW - 1000, feature: 'results' }] });
class MemoryStorage implements UsageStorage {
  rows = new Map<string, string>();
  failWrites = false;
  get length() { return this.rows.size; }
  key(index: number) { return [...this.rows.keys()][index] ?? null; }
  getItem(key: string) { return this.rows.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error('quota'); this.rows.set(key, value); }
  removeItem(key: string) { this.rows.delete(key); }
}
class MemoryLocks implements UsageLocks {
  held = new Set<string>();
  async run(name: string, availableOnly: boolean, work: (locked: boolean) => Promise<void>) {
    if (this.held.has(name)) {
      if (availableOnly) return work(false);
      throw new Error('Unexpected duplicate instance key');
    }
    this.held.add(name);
    try { await work(true); } finally { this.held.delete(name); }
  }
}
const queues: UsageQueue[] = [];
function queue(storage: UsageStorage, locks: UsageLocks | undefined, instance: string, uid = 'athlete', now = () => NOW) {
  const q = new UsageQueue(uid, instance, storage, locks, now); queues.push(q); return q;
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => queues.splice(0).forEach(q => q.close()));

describe('actor-owned durable browser queue', () => {
  it('recovers a closed offline tab into a fresh instance with exact immutable batches', async () => {
    const storage = new MemoryStorage(), locks = new MemoryLocks();
    const old = queue(storage, locks, 'old'); await old.start(); old.append(batch());
    old.close(); await settle();
    const fresh = queue(storage, locks, 'fresh'); await fresh.start();
    expect(fresh.key).not.toBe(old.key); expect(fresh.ownsLock).toBe(true);
    expect(fresh.head()).toEqual(batch()); expect(storage.getItem(old.key)).toBeNull();
    expect(JSON.parse(storage.getItem(fresh.key)!).batches).toEqual([batch()]);
  });
  it('does not steal from a live tab, then recovers after that tab closes', async () => {
    const storage = new MemoryStorage(), locks = new MemoryLocks();
    const first = queue(storage, locks, 'first'); await first.start(); first.append(batch());
    const second = queue(storage, locks, 'second'); await second.start();
    expect(second.size).toBe(0); expect(first.head()).toEqual(batch());
    first.close(); await settle(); await second.recover();
    expect(second.head()).toEqual(batch()); expect(storage.getItem(first.key)).toBeNull();
  });
  it('leaves source intact when destination persistence fails', async () => {
    const storage = new MemoryStorage(), locks = new MemoryLocks();
    const old = queue(storage, locks, 'old'); await old.start(); old.append(batch()); old.close(); await settle();
    const before = storage.getItem(old.key); storage.failWrites = true;
    const fresh = queue(storage, locks, 'fresh'); await fresh.start();
    expect(fresh.size).toBe(0); expect(storage.getItem(old.key)).toBe(before);
    storage.failWrites = false; await fresh.recover(); expect(fresh.head()).toEqual(batch());
  });
  it('copies legacy or lockless sources without deleting or repeatedly adopting them in one load', async () => {
    const storage = new MemoryStorage(), legacy = `${STORE_PREFIX}athlete:legacy`;
    storage.setItem(legacy, JSON.stringify([batch()]));
    const q = queue(storage, undefined, 'fresh'); await q.start();
    expect(q.head()).toEqual(batch()); expect(storage.getItem(legacy)).not.toBeNull();
    q.acknowledge(batch()); await q.recover(); expect(q.size).toBe(0);
    const locked = queue(storage, new MemoryLocks(), 'locked'); await locked.start();
    expect(locked.head()).toEqual(batch()); expect(storage.getItem(legacy)).not.toBeNull();
  });
  it('matches the complete actor segment and clears foreign queues on auth change', async () => {
    const storage = new MemoryStorage();
    const own = `${STORE_PREFIX}athlete:old`, foreign = `${STORE_PREFIX}athlete:other:old`;
    storage.setItem(own, JSON.stringify([batch()])); storage.setItem(foreign, JSON.stringify([batch(1)]));
    storage.setItem('unrelated', 'keep');
    const q = queue(storage, undefined, 'fresh'); await q.start();
    expect(q.size).toBe(1); expect(q.head()?.sequence).toBe(0);
    removeOtherActorQueues(storage, 'athlete'); expect(storage.getItem(foreign)).toBeNull(); expect(storage.getItem('unrelated')).toBe('keep');
    removeOtherActorQueues(storage, null); expect([...storage.rows.keys()]).toEqual(['unrelated']);
  });
  it('keeps an unadopted overflow source until there is capacity', async () => {
    const storage = new MemoryStorage(), locks = new MemoryLocks();
    const full = queue(storage, locks, 'full'); await full.start();
    for (let i = 0; i < 120; i++) full.append(batch(i));
    const source = `${STORE_PREFIX}athlete:orphan`;
    storage.setItem(source, JSON.stringify({ version: 2, batches: [batch(120)] }));
    await full.recover(); expect(full.size).toBe(120); expect(storage.getItem(source)).not.toBeNull();
    full.acknowledge(batch(0)); await full.recover();
    expect(full.size).toBe(120); expect(storage.getItem(source)).toBeNull();
  });
  it('rejects expired or malformed persisted data and bounds the in-memory queue', async () => {
    const storage = new MemoryStorage(); storage.setItem(`${STORE_PREFIX}athlete:old`, JSON.stringify([{
      ...batch(), intervals: [{ startedAtMillis: NOW - 73 * 3600000, endedAtMillis: NOW - 73 * 3600000 + 1000, feature: 'results' }],
    }, { ...batch(), playerId: 'not-authoritative' }]));
    const q = queue(storage, undefined, 'fresh'); await q.start(); expect(q.size).toBe(0);
    for (let i = 0; i < 130; i++) q.append(batch(i));
    expect(q.size).toBe(120); expect(q.head()?.sequence).toBe(10);
  });
});

describe('delivery acknowledgements and account isolation', () => {
  it('retries the exact immutable head with backoff and throttles successful offline draining', async () => {
    const storage = new MemoryStorage(); let now = NOW, online = false, fail = true;
    const q = queue(storage, undefined, 'retry', 'athlete', () => now); await q.start(); q.append(batch()); q.append(batch(1));
    const sent: UsageBatch[] = [];
    const d = new UsageDelivery('athlete', q, () => 'athlete', () => online, () => now, async b => {
      sent.push(structuredClone(b)); if (fail) throw { code: 'functions/resource-exhausted' }; return { accepted: true };
    }, () => {});
    await d.send(); expect(sent).toEqual([]); online = true; await d.send();
    now += 9999; await d.send(); expect(sent).toHaveLength(1);
    fail = false; now++; await d.send(); expect(sent).toEqual([batch(), batch()]); expect(q.size).toBe(1);
    await d.send(); now += 5999; await d.send(); expect(sent).toHaveLength(2);
    now++; await d.send(); expect(sent[2]).toEqual(batch(1)); expect(q.size).toBe(0);
  });
  it.each(['permission-denied', 'unauthenticated'])('clears and stops on %s until a new auth session', async code => {
    const q = queue(new MemoryStorage(), undefined, 'denied'); await q.start(); q.append(batch());
    let cleared = 0, calls = 0;
    const d = new UsageDelivery('athlete', q, () => 'athlete', () => true, () => NOW, async () => { calls++; throw { code: `functions/${code}` }; }, () => { cleared++; });
    await d.send(); await d.send(); expect(q.size).toBe(0); expect(cleared).toBe(1); expect(calls).toBe(1); expect(d.active).toBe(false);
  });
  it('drops a disabled batch and pauses delivery for five minutes', async () => {
    let now = NOW, calls = 0, cleared = 0;
    const q = queue(new MemoryStorage(), undefined, 'disabled', 'athlete', () => now); await q.start(); q.append(batch());
    const d = new UsageDelivery('athlete', q, () => 'athlete', () => true, () => now, async () => { calls++; return { accepted: false, reason: 'disabled' }; }, () => { cleared++; });
    await d.send(); expect(q.size).toBe(0); expect(cleared).toBe(1); q.append(batch(1));
    now += 299999; await d.send(); expect(calls).toBe(1); now++; await d.send(); expect(calls).toBe(2);
  });
  it.each(['invalid-argument', 'already-exists'])('drops a malformed/conflicting batch on %s', async code => {
    const q = queue(new MemoryStorage(), undefined, code); await q.start(); q.append(batch());
    const d = new UsageDelivery('athlete', q, () => 'athlete', () => true, () => NOW, async () => { throw { code: `functions/${code}` }; }, () => {});
    await d.send(); expect(q.size).toBe(0); expect(d.active).toBe(true);
  });
});

class FakeBrowser implements UsageEnvironment {
  time = NOW; monoTime = 0; uid: string | undefined = 'athlete'; connected = true; shown = true; video = false;
  currentFeature: UsageFeature | null = 'training';
  events = new Map<string, Set<(event: { isTrusted?: boolean; detail?: { active?: boolean } }) => void>>();
  timers = new Set<{ period: number; next: number; action: () => void }>();
  wall = () => this.time; mono = () => this.monoTime; currentUid = () => this.uid;
  online = () => this.connected; visible = () => this.shown; feature = () => this.currentFeature; progressingVideo = () => this.video;
  on(name: string, listener: (event: { isTrusted?: boolean; detail?: { active?: boolean } }) => void) {
    const rows = this.events.get(name) ?? new Set(); rows.add(listener); this.events.set(name, rows); return () => { rows.delete(listener); };
  }
  every(period: number, action: () => void) { const timer = { period, next: this.monoTime + period, action }; this.timers.add(timer); return () => { this.timers.delete(timer); }; }
  emit(name: string, event = {}) { this.events.get(name)?.forEach(listener => listener(event)); }
  async advance(milliseconds: number) {
    const end = this.monoTime + milliseconds;
    while (this.monoTime < end) {
      const next = Math.min(end, ...[...this.timers].map(t => t.next)); this.time += next - this.monoTime; this.monoTime = next;
      for (const timer of this.timers) if (timer.next <= this.monoTime) { timer.next += timer.period; timer.action(); }
      await settle();
    }
  }
}
function session(env: FakeBrowser, q: UsageQueue, invoke: (batch: UsageBatch) => Promise<{ accepted?: boolean; reason?: string }>) {
  return createUsageSession({ uid: 'athlete', sessionId: '00000000-0000-4000-8000-000000000002', build: 'web-test', queue: q, environment: env, invoke });
}

describe('browser lifecycle with injected storage, locks and callable', () => {
  it('reopens a closed offline tab and acknowledges its recovered batch without changing the payload', async () => {
    const storage = new MemoryStorage(), locks = new MemoryLocks(), env = new FakeBrowser(); env.connected = false;
    const old = queue(storage, locks, 'offline', 'athlete', env.wall), first = session(env, old, async () => { throw new Error('offline'); });
    await first.start(); await env.advance(30000); first.close(); await settle();
    const saved = old.head(); expect(saved?.intervals).toEqual([{ startedAtMillis: NOW, endedAtMillis: NOW + 30000, feature: 'training' }]);
    env.connected = true; const sent: UsageBatch[] = [], fresh = queue(storage, locks, 'reopened', 'athlete', env.wall);
    const reopened = session(env, fresh, async b => { sent.push(structuredClone(b)); return { accepted: true }; });
    await reopened.start(); await settle(); expect(sent).toEqual([saved]); expect(fresh.size).toBe(0); reopened.close();
  });
  it('does not resurrect an old actor queue when a request completes after an account switch', async () => {
    const storage = new MemoryStorage(), env = new FakeBrowser(), q = queue(storage, undefined, 'old', 'athlete', env.wall);
    let resolve!: (result: { accepted: boolean }) => void;
    const old = session(env, q, async () => new Promise(done => { resolve = done; }));
    await old.start(); await env.advance(30000); expect(resolve).toBeTypeOf('function');
    env.uid = 'next-athlete'; old.close(); removeOtherActorQueues(storage, env.uid);
    resolve({ accepted: true }); await settle();
    expect(storage.length).toBe(0); expect(env.timers.size).toBe(0);
    expect([...env.events.values()].every(listeners => listeners.size === 0)).toBe(true);
  });
  it('cancels asynchronous startup before installing listeners after auth changes', async () => {
    const storage = new MemoryStorage(), env = new FakeBrowser();
    let release!: () => void;
    const delayed: UsageLocks = { run: async (_name, _available, work) => { await new Promise<void>(done => { release = done; }); await work(true); } };
    const q = queue(storage, delayed, 'waiting', 'athlete', env.wall), running = session(env, q, async () => ({ accepted: true }));
    const started = running.start(); env.uid = undefined; running.close(); removeOtherActorQueues(storage, null); release(); await started;
    expect(env.timers.size).toBe(0); expect(storage.length).toBe(0); expect(q.ownsLock).toBe(false);
  });
  it('keeps visible guided workouts ahead of videos and ignores hidden progress', async () => {
    const storage = new MemoryStorage(), env = new FakeBrowser(); env.connected = false; env.video = true;
    const q = queue(storage, undefined, 'features', 'athlete', env.wall), running = session(env, q, async () => ({ accepted: true }));
    await running.start();
    for (let second = 0; second < 3; second++) { env.emit('posetek:usage-workout', { detail: { active: true } }); await env.advance(1000); }
    env.shown = false; env.emit('visibilitychange');
    env.emit('posetek:usage-workout', { detail: { active: true } }); await env.advance(30000);
    expect(q.head()?.intervals).toEqual([{ startedAtMillis: NOW, endedAtMillis: NOW + 3000, feature: 'workout' }]);
    running.close();
  });
  it('resumes an idle page only on trusted interaction, not synthetic events', async () => {
    const storage = new MemoryStorage(), env = new FakeBrowser(); env.connected = false;
    const q = queue(storage, undefined, 'idle', 'athlete', env.wall), running = session(env, q, async () => ({ accepted: true }));
    await running.start(); await env.advance(150000);
    const before = JSON.parse(storage.getItem(q.key)!).batches.length;
    env.emit('pointerdown', { isTrusted: false }); await env.advance(30000);
    expect(JSON.parse(storage.getItem(q.key)!).batches).toHaveLength(before);
    env.emit('pointerdown', { isTrusted: true }); await env.advance(30000);
    expect(JSON.parse(storage.getItem(q.key)!).batches).toHaveLength(before + 1); running.close();
  });
});
