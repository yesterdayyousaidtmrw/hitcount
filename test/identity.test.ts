import { describe, expect, it, vi } from 'vitest';
import { createIdentity } from '../src/core/identity';
import { blockStorage } from './helpers';

const MINUTE = 60_000;

describe('createIdentity', () => {
  it('keeps a session alive while active and starts a new one after the timeout', () => {
    vi.useFakeTimers();
    const identity = createIdentity('session', 30 * MINUTE);
    identity.enable();
    const first = identity.session();
    vi.advanceTimersByTime(29 * MINUTE);
    expect(identity.session()).toBe(first);
    vi.advanceTimersByTime(29 * MINUTE);
    expect(identity.session()).toBe(first);
    vi.advanceTimersByTime(31 * MINUTE);
    expect(identity.session()).not.toBe(first);
  });

  it('only issues a returning-visitor id with persistent storage', () => {
    const tabOnly = createIdentity('session', MINUTE);
    tabOnly.enable();
    expect(tabOnly.visitor()).toBeUndefined();

    const first = createIdentity('local', MINUTE);
    first.enable();
    const later = createIdentity('local', MINUTE);
    later.enable();
    expect(later.visitor()).toBe(first.visitor());
  });

  it('writes nothing to storage before enable()', () => {
    const identity = createIdentity('local', MINUTE);
    identity.visitor();
    identity.session();
    identity.setUser('u_1');
    expect(localStorage.length).toBe(0);

    identity.enable();
    expect(localStorage.getItem('_analy_u')).toBe('u_1');
  });

  it.each(['cookie', 'local', 'session'] as const)('falls back to memory when %s storage throws', (persist) => {
    const unblock = blockStorage();
    try {
      const identity = createIdentity(persist, MINUTE);
      identity.enable();
      const session = identity.session();
      expect(session).toMatch(/^[0-9a-f-]{36}$/);
      expect(identity.session()).toBe(session);
    } finally {
      unblock();
    }
  });

  it('keeps store values in memory until enable(), then under _analy_x_ in the persist mode', () => {
    const identity = createIdentity('local', MINUTE);
    identity.store.set('note', 'early');
    expect(identity.store.get('note')).toBe('early');
    expect(localStorage.length).toBe(0);

    identity.enable();
    identity.store.set('note', 'kept');
    expect(localStorage.getItem('_analy_x_note')).toBe('kept');
    identity.store.remove('note');
    expect(localStorage.getItem('_analy_x_note')).toBeNull();
  });

  it.each(['reset', 'wipe'] as const)('%s() removes store keys, including one an earlier page wrote', (method) => {
    const earlier = createIdentity('local', MINUTE);
    earlier.enable();
    earlier.store.set('note', 'from the last page');

    const identity = createIdentity('local', MINUTE);
    identity.enable();
    expect(identity.store.get('note')).toBe('from the last page');
    identity[method]();
    expect(localStorage.getItem('_analy_x_note')).toBeNull();
    expect(identity.store.get('note')).toBeUndefined();
  });

  it('round-trips store values a raw cookie could not hold', () => {
    const value = JSON.stringify({ landing: '/a;b c', utm: { source: 'news, letter' } });
    const identity = createIdentity('cookie', MINUTE);
    identity.enable();
    identity.store.set('attribution', value);

    const nextPage = createIdentity('cookie', MINUTE);
    nextPage.enable();
    expect(nextPage.store.get('attribution')).toBe(value);
  });

  it('uses a first-party cookie in cookie mode and removes it on wipe()', () => {
    const identity = createIdentity('cookie', MINUTE);
    identity.enable();
    const visitor = identity.visitor();
    expect(document.cookie).toContain(`_analy_v=${visitor}`);
    identity.wipe();
    expect(document.cookie).not.toContain('_analy_v');
  });
});
