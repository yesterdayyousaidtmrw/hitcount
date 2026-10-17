import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http } from '../src/sinks/http';
import type { Hitcount, HitcountEvent, Sink } from '../src/types';
import { setVisibility, track } from './helpers';

// Longer than the whole default backoff (2s + 10s + 30s + 2min + 2min).
const AGES = 10 * 60_000;
const settle = () => vi.advanceTimersByTimeAsync(0);
const names = (events: HitcountEvent[]) => events.map((e) => e.name);

/** A sink that rejects every batch until heal(): `offered` is every batch it saw, `taken` what it kept. */
function flakySink(name = 'flaky') {
  const offered: string[][] = [];
  const taken: HitcountEvent[] = [];
  let healthy = false;
  const sink: Sink = {
    name,
    send(events) {
      offered.push(names(events));
      if (!healthy) return Promise.reject(new Error('offline'));
      taken.push(...events);
    },
  };
  return { sink, offered, taken, heal: () => void (healthy = true) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('retry outbox', () => {
  it('retries a failed batch with backoff and delivers it once the sink recovers, leaving other sinks alone', async () => {
    const onError = vi.fn();
    const flaky = flakySink();
    const { hitcount, sent } = track({ sinks: [flaky.sink], onError });
    hitcount.track('a');
    await settle();
    expect(flaky.offered).toEqual([['a']]);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(flaky.offered).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(flaky.offered).toHaveLength(2);

    flaky.heal();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(AGES);
    expect(names(flaky.taken)).toEqual(['a']);
    expect(flaky.offered).toHaveLength(3);
    expect(names(sent)).toEqual(['a']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('gives up after maxRetries (default 5) and reports the dropped batch once', async () => {
    const onError = vi.fn();
    const down = new Error('down');
    const send = vi.fn(() => {
      throw down;
    });
    track({ sinks: [{ name: 'down', send }], onError }).hitcount.track('a');
    await vi.advanceTimersByTimeAsync(AGES);
    expect(send).toHaveBeenCalledTimes(6);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(down, 'sink:down');
  });

  it('drops at once, with one onError, a batch whose error says retryable: false', async () => {
    const onError = vi.fn();
    const refused = Object.assign(new Error('bad batch'), { retryable: false });
    const send = vi.fn().mockRejectedValue(refused);
    track({ sinks: [{ name: 'strict', send }], onError }).hitcount.track('a');
    await vi.advanceTimersByTimeAsync(AGES);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(refused, 'sink:strict');
  });

  it('retries an http 503 but not a 400', async () => {
    const onError = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const { hitcount } = track({ sinks: [http('https://c.test/e')], onError });

    hitcount.track('a');
    await vi.advanceTimersByTimeAsync(AGES);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();

    hitcount.track('b');
    await vi.advanceTimersByTimeAsync(AGES);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ message: 'HTTP 400 from https://c.test/e', retryable: false });
  });

  it('keeps the newest 100 events per sink and reports each one it had to drop', async () => {
    const onError = vi.fn();
    const flaky = flakySink();
    const { hitcount } = track({ sinks: [flaky.sink], onError, maxRetries: 10 });
    for (let i = 0; i < 120; i++) hitcount.track(`e${i}`);
    await settle();
    flaky.heal();
    await vi.advanceTimersByTimeAsync(AGES);
    expect(names(flaky.taken)).toEqual(Array.from({ length: 100 }, (_, i) => `e${i + 20}`));
    expect(onError).toHaveBeenCalledTimes(20);
    expect(new Set(onError.mock.calls.map((call) => call[1]))).toEqual(new Set(['sink:flaky']));
  });

  it('keeps the outbox across pages, and sends it only once consent is granted', async () => {
    const first = flakySink();
    const before = track({ persist: 'local', sinks: [first.sink] });
    before.hitcount.track('a');
    await settle();
    setVisibility('hidden');
    before.hitcount.destroy();
    expect(localStorage.getItem('_hitcount_x_outbox.flaky')).not.toBeNull();

    const next = flakySink();
    next.heal();
    const after = track({ persist: 'local', consent: 'pending', sinks: [next.sink] });
    await vi.advanceTimersByTimeAsync(AGES);
    expect(next.offered).toEqual([]);

    after.hitcount.consent('granted');
    await settle();
    expect(names(next.taken)).toEqual(['a']);
  });

  it('counts retries across pages, so a dead endpoint is not hit again on every page load', async () => {
    const before = track({ persist: 'local', sinks: [flakySink().sink], maxRetries: 1 });
    before.hitcount.track('a');
    await settle();
    setVisibility('hidden');
    before.hitcount.destroy();

    const onError = vi.fn();
    const next = flakySink();
    track({ persist: 'local', sinks: [next.sink], maxRetries: 1, onError });
    await vi.advanceTimersByTimeAsync(AGES);
    expect(next.offered).toEqual([['a']]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not queue an event twice when the saved outbox is read back on the same page', async () => {
    const flaky = flakySink();
    const { hitcount } = track({ persist: 'local', sinks: [flaky.sink] });
    hitcount.track('a');
    await settle();
    setVisibility('hidden');
    // A consent banner confirming again: release() reads the saved outbox back in.
    hitcount.consent('granted');
    flaky.heal();
    await vi.advanceTimersByTimeAsync(AGES);
    expect(names(flaky.taken)).toEqual(['a']);
  });

  it('forgets the outbox on reset() and when consent is denied', async () => {
    const forgetters: Array<(hitcount: Hitcount) => void> = [(hitcount) => hitcount.reset(), (hitcount) => hitcount.consent('denied')];
    for (const forget of forgetters) {
      const flaky = flakySink();
      const { hitcount } = track({ persist: 'local', sinks: [flaky.sink] });
      hitcount.track('a');
      await settle();
      setVisibility('hidden');
      expect(localStorage.getItem('_hitcount_x_outbox.flaky')).not.toBeNull();

      forget(hitcount);
      expect(localStorage.getItem('_hitcount_x_outbox.flaky')).toBeNull();
      flaky.heal();
      await vi.advanceTimersByTimeAsync(AGES);
      expect(flaky.taken).toEqual([]);
      hitcount.destroy();
    }
  });

  it('sends nothing more once destroyed, not even a retry for a send still in flight', async () => {
    const flaky = flakySink();
    let rejectLater: (error: Error) => void = () => {};
    const slow = vi.fn(() => new Promise((_, reject) => (rejectLater = reject)));
    const { hitcount } = track({ sinks: [flaky.sink, { name: 'slow', send: slow }] });
    hitcount.track('a');
    await settle();
    hitcount.destroy();
    rejectLater(new Error('timed out'));
    flaky.heal();
    await vi.advanceTimersByTimeAsync(AGES);
    expect(flaky.offered).toHaveLength(1);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('reports a storage write that fails (quota) as outbox, without throwing into the page', async () => {
    const quota = new DOMException('full', 'QuotaExceededError');
    // A full localStorage that still takes the ids, so only the outbox write fails.
    const real = localStorage;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => real.getItem(key),
      setItem: (key: string, value: string) => {
        if (key.startsWith('_hitcount_x_outbox')) throw quota;
        real.setItem(key, value);
      },
      removeItem: (key: string) => real.removeItem(key),
      // resetDom() clears storage after each test, before the stub is undone.
      clear: () => real.clear(),
    });
    const onError = vi.fn();
    const { hitcount } = track({ persist: 'local', sinks: [flakySink().sink], onError });
    hitcount.track('a');
    await settle();
    expect(() => setVisibility('hidden')).not.toThrow();
    expect(onError).toHaveBeenCalledWith(quota, 'outbox');
    expect(real.getItem('_hitcount_v')).not.toBeNull();
  });

  it('never puts the outbox in a cookie', async () => {
    const { hitcount } = track({ persist: 'cookie', sinks: [flakySink().sink] });
    hitcount.track('a');
    await settle();
    setVisibility('hidden');
    expect(document.cookie).toContain('_hitcount_v');
    expect(document.cookie).not.toContain('outbox');
  });
});
