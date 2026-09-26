import { describe, expect, it } from 'vitest';
import { isCurrentRosterRequest } from './rosterRequest';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('roster response ownership', () => {
  it('keeps B when A finishes after B, then accepts a fresh A selection', async () => {
    let latest = 0;
    let currentUid: string | undefined = 'coach';
    let visible = '';
    const apply = (request: number, uid: string, value: string) => {
      if (isCurrentRosterRequest(request, latest, uid, currentUid)) visible = value;
    };
    const oldA = deferred<string>(); const b = deferred<string>(); const newA = deferred<string>();
    const aRequest = ++latest; void oldA.promise.then(value => apply(aRequest, 'coach', value));
    const bRequest = ++latest; void b.promise.then(value => apply(bRequest, 'coach', value));
    b.resolve('B'); await b.promise; await Promise.resolve();
    oldA.resolve('old A'); await oldA.promise; await Promise.resolve();
    expect(visible).toBe('B');
    const newRequest = ++latest; void newA.promise.then(value => apply(newRequest, 'coach', value));
    newA.resolve('new A'); await newA.promise; await Promise.resolve();
    expect(visible).toBe('new A');
    currentUid = undefined;
    expect(isCurrentRosterRequest(newRequest, latest, 'coach', currentUid)).toBe(false);
  });
  it('rejects an old account and an older refresh after access changes', () => {
    expect(isCurrentRosterRequest(2, 2, 'coach-one', 'coach-two')).toBe(false);
    expect(isCurrentRosterRequest(1, 2, 'coach-one', 'coach-one')).toBe(false);
  });
});
