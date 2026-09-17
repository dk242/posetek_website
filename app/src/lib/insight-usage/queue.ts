import { validSavedBatch } from './clock';
import type { UsageBatch } from './clock';

export const STORE_PREFIX = 'posetek:engagement:v1:';
const MAX_QUEUE = 120;
const MAX_RECOVERY_KEYS = 256;
export type UsageStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
export interface UsageLocks {
  run(name: string, availableOnly: boolean, work: (locked: boolean) => Promise<void>): Promise<void>;
}
const identity = (batch: UsageBatch) => `${batch.sessionId.toLowerCase()}:${batch.sequence}`;
const belongsTo = (key: string, uid: string) => key.startsWith(STORE_PREFIX)
  && key.slice(STORE_PREFIX.length, key.lastIndexOf(':')) === uid;

export function browserUsageLocks(): UsageLocks | undefined {
  if (!navigator.locks) return undefined;
  return { run: (name, availableOnly, work) => navigator.locks.request(name, { mode: 'exclusive', ifAvailable: availableOnly }, lock => work(!!lock)) };
}

export function removeOtherActorQueues(storage: UsageStorage | undefined, uid: string | null) {
  try {
    if (!storage) return;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(STORE_PREFIX) && (!uid || !belongsTo(key, uid))) storage.removeItem(key);
    }
  } catch { /* Optional browser storage. */ }
}

/// Each live instance owns a new key, even after duplicating a browser tab.
/// Web Locks prevent recovery from stealing an active writer's queue. Recovery
/// saves the destination before deleting a closed writer's source. Without Web
/// Locks, immutable batches may be copied, but source queues are never deleted:
/// server idempotence safely handles those duplicates without losing new writes.
export class UsageQueue {
  readonly key: string;
  readonly uid: string;
  private storage: UsageStorage | undefined;
  private locks: UsageLocks | undefined;
  private now: () => number;
  private batches: UsageBatch[] = [];
  private adopted = new Set<string>();
  private release?: () => void;
  private closed = false;
  private lockHeld = false;
  constructor(uid: string, instanceId: string, storage: UsageStorage | undefined,
              locks: UsageLocks | undefined, now: () => number) {
    this.uid = uid; this.storage = storage; this.locks = locks; this.now = now;
    this.key = `${STORE_PREFIX}${uid}:${instanceId}`;
  }

  async start() {
    if (this.locks) {
      await new Promise<void>(resolve => {
        void this.locks!.run(this.key, false, async locked => {
          if (!locked || this.closed) { resolve(); return; }
          this.lockHeld = true;
          await new Promise<void>(release => { this.release = release; resolve(); });
        }).catch(() => { this.locks = undefined; resolve(); });
      });
    }
    if (!this.closed) await this.recover();
  }

  private read(raw: string | null): UsageBatch[] {
    try {
      if (!raw || raw.length > 4_000_000) return [];
      const decoded = JSON.parse(raw), rows = Array.isArray(decoded) ? decoded : decoded?.version === 2 ? decoded.batches : [];
      return Array.isArray(rows) ? rows.filter(row => validSavedBatch(row, this.now())).slice(-MAX_QUEUE) : [];
    } catch { return []; }
  }

  async recover() {
    if (this.closed || !this.storage) return;
    let keys: string[] = [];
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key && belongsTo(key, this.uid) && key !== this.key) keys.push(key);
      }
    } catch { return; }
    keys = keys.slice(-MAX_RECOVERY_KEYS);
    for (const key of keys) {
      const copy = async (locked: boolean) => {
        if (this.closed || (this.locks && !locked)) return;
        try {
          const raw = this.storage!.getItem(key), rows = this.read(raw);
          const missing = rows.filter(row => !this.adopted.has(identity(row)) && !this.batches.some(b => identity(b) === identity(row)));
          const additions = missing.slice(0, Math.max(0, MAX_QUEUE - this.batches.length));
          const before = this.batches;
          this.batches = [...before, ...additions];
          // A failed destination save must leave the recoverable source intact.
          if (this.persist()) {
            additions.forEach(row => this.adopted.add(identity(row)));
            if (this.adopted.size > 20_000) this.adopted = new Set([...this.adopted].slice(-10_000));
            // Legacy arrays did not hold a lock; copy them without destructive adoption.
            if (locked && additions.length === missing.length && raw && !Array.isArray(JSON.parse(raw)) && this.storage!.getItem(key) === raw) this.storage!.removeItem(key);
          } else { this.batches = before; }
        } catch { /* A live queue or quota/storage failure remains recoverable. */ }
      };
      if (this.locks) await this.locks.run(key, true, copy).catch(() => {});
      else await copy(false);
    }
  }

  append(batch: UsageBatch) {
    if (this.closed) return;
    this.batches = [...this.batches, batch].filter(b => validSavedBatch(b, this.now())).slice(-MAX_QUEUE);
    this.persist();
  }
  head() {
    this.batches = this.batches.filter(b => validSavedBatch(b, this.now()));
    return this.batches[0];
  }
  acknowledge(batch: UsageBatch) { this.batches = this.batches.filter(b => identity(b) !== identity(batch)); this.persist(); }
  clear() { this.batches = []; this.persist(); }
  persist(): boolean {
    if (this.closed || !this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify({ version: 2, batches: this.batches }));
      return true;
    } catch { return false; }
  }
  close() { this.closed = true; this.release?.(); this.release = undefined; this.lockHeld = false; }
  get size() { return this.batches.length; }
  get ownsLock() { return this.lockHeld; }
}

export class UsageDelivery {
  active = true;
  disabledUntil = 0;
  nextSend = 0;
  private busy = false;
  private failures = 0;
  private uid: string;
  private queue: UsageQueue;
  private currentUid: () => string | undefined;
  private online: () => boolean;
  private now: () => number;
  private invoke: (batch: UsageBatch) => Promise<{ accepted?: boolean; reason?: string }>;
  private clearPending: () => void;
  constructor(uid: string, queue: UsageQueue, currentUid: () => string | undefined,
              online: () => boolean, now: () => number,
              invoke: (batch: UsageBatch) => Promise<{ accepted?: boolean; reason?: string }>,
              clearPending: () => void) {
    this.uid = uid; this.queue = queue; this.currentUid = currentUid; this.online = online;
    this.now = now; this.invoke = invoke; this.clearPending = clearPending;
  }

  async send() {
    if (!this.active || this.busy || this.currentUid() !== this.uid || this.now() < Math.max(this.disabledUntil, this.nextSend) || !this.online()) return;
    const head = this.queue.head(); if (!head) return;
    this.busy = true;
    try {
      const result = await this.invoke(head);
      if (!this.active || this.currentUid() !== this.uid) return;
      if (result?.accepted === true) { this.queue.acknowledge(head); this.failures = 0; this.nextSend = this.now() + 6000; }
      else if (result?.reason === 'disabled') { this.queue.clear(); this.clearPending(); this.disabledUntil = this.now() + 300000; }
      else throw new Error('Unacknowledged usage batch');
    } catch (error: any) {
      if (!this.active || this.currentUid() !== this.uid) return;
      const code = String(error?.code || '').replace('functions/', '');
      if (['permission-denied', 'unauthenticated'].includes(code)) { this.active = false; this.queue.clear(); this.clearPending(); }
      else if (['invalid-argument', 'already-exists'].includes(code)) this.queue.acknowledge(head);
      else { this.failures++; this.nextSend = this.now() + Math.min(300000, 5000 * 2 ** Math.min(this.failures, 6)); }
    } finally { this.busy = false; }
  }
  close() { this.active = false; }
}
