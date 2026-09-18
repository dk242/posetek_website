import { describe, expect, it } from 'vitest';
import { createPlaybackCoordinator } from './media-playback';

function fixture() {
  const coordinator = createPlaybackCoordinator();
  const active = new Set<string>();
  const events: string[] = [];
  const register = (id: string) => coordinator.register(id, value => {
    events.push(`${id}:${value}`);
    if (value) active.add(id); else active.delete(id);
    // Assert during each callback, not just after the update: the previous
    // media must stop before the incoming media is allowed to start.
    expect(active.size).toBeLessThanOrEqual(1);
  });
  return { coordinator, active, events, register };
}

describe('feed playback coordination', () => {
  it('stops the old video before starting the largest eligible visible card', () => {
    const f = fixture(); f.register('first'); f.register('second'); f.register('third');
    f.coordinator.update('second', 200, true);
    f.coordinator.update('first', 80, true);
    f.coordinator.update('third', 300, true);
    expect(f.coordinator.current()).toBe('third');
    expect([...f.active]).toEqual(['third']);
    expect(f.events).toEqual(['second:true', 'second:false', 'third:true']);
  });

  it('does not choose registered, hidden, zero-area or invalid-area entries', () => {
    const f = fixture(); f.register('card');
    expect(f.coordinator.current()).toBeNull();
    for (const area of [0, -1, NaN, Infinity]) f.coordinator.update('card', area, true);
    f.coordinator.update('card', 1000, false);
    f.coordinator.update('unknown', 5000, true);
    f.coordinator.activate('unknown');
    expect(f.events).toEqual([]);
    expect(f.coordinator.current()).toBeNull();
  });

  it('avoids border flicker until a competing card has a meaningful visibility lead', () => {
    const f = fixture(); f.register('a'); f.register('b');
    f.coordinator.update('a', 100, true);
    for (const area of [100, 105, 114, 110, 100]) f.coordinator.update('b', area, true);
    expect(f.events).toEqual(['a:true']);
    f.coordinator.update('b', 116, true);
    expect(f.coordinator.current()).toBe('b');
    f.coordinator.update('a', 125, true);
    expect(f.coordinator.current()).toBe('b');
    f.coordinator.update('a', 140, true);
    expect(f.events).toEqual(['a:true', 'a:false', 'b:true', 'b:false', 'a:true']);
  });

  it('hands playback off when the current card becomes hidden and restores only on new visibility evidence', () => {
    const f = fixture(); f.register('a'); f.register('b');
    f.coordinator.update('a', 200, true); f.coordinator.update('b', 100, true);
    f.coordinator.suspend('a');
    expect(f.coordinator.current()).toBe('b');
    f.coordinator.suspend('b');
    expect(f.coordinator.current()).toBeNull();
    expect(f.active.size).toBe(0);
    f.coordinator.update('a', 200, false);
    expect(f.coordinator.current()).toBeNull();
    f.coordinator.update('b', 100, true);
    expect(f.coordinator.current()).toBe('b');
  });

  it('honors an explicit play action while still pausing the prior video first', () => {
    const f = fixture(); f.register('a'); f.register('b');
    f.coordinator.update('a', 400, true);
    f.coordinator.activate('b');
    expect(f.coordinator.current()).toBe('b');
    expect(f.events).toEqual(['a:true', 'a:false', 'b:true']);
    f.coordinator.activate('b');
    expect(f.events).toHaveLength(3);
    f.coordinator.suspend('b');
    expect(f.coordinator.current()).toBe('a');
  });

  it('unregisters cleanly, chooses the next eligible card and ignores late observations', () => {
    const f = fixture(); const removeA = f.register('a'), removeB = f.register('b'), removeC = f.register('c');
    f.coordinator.update('a', 300, true); f.coordinator.update('b', 200, true); f.coordinator.update('c', 100, true);
    removeC();
    expect(f.events).toEqual(['a:true']);
    removeA();
    expect(f.coordinator.current()).toBe('b');
    expect(f.events).toEqual(['a:true', 'a:false', 'b:true']);
    f.coordinator.update('a', 900, true); f.coordinator.activate('a');
    expect(f.coordinator.current()).toBe('b');
    removeB(); removeA();
    expect(f.coordinator.current()).toBeNull();
    expect(f.active.size).toBe(0);
  });

  it('retains the current card across equal visibility updates without repeat play notifications', () => {
    const f = fixture(); f.register('a'); f.register('b');
    f.coordinator.update('b', 100, true); f.coordinator.update('a', 100, true);
    f.coordinator.update('b', 100, true); f.coordinator.update('a', 100, true);
    expect(f.coordinator.current()).toBe('b');
    expect(f.events).toEqual(['b:true']);
  });
});
