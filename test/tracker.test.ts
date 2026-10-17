import { describe, expect, it, vi } from 'vitest';
import { device } from '../src/plugins/device';
import { pageviews } from '../src/plugins/pageviews';
import { traffic } from '../src/plugins/traffic';
import type { Plugin } from '../src/types';
import { setVisibility, track } from './helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createHitcount', () => {
  it('does the same for plugins added with use(), as the script builds add theirs', () => {
    const { hitcount, sent } = track({ plugins: [] });
    hitcount.use(pageviews(), traffic(), device());
    hitcount.track('later');
    const [landing, later] = sent;
    expect(landing.device).toEqual(later.device);
    expect(landing.traffic).toEqual(later.traffic);
  });

  it('enriches an event a plugin sends from its setup with what later plugins set up', () => {
    // The script builds list pageviews first, and it sends the landing page view from its setup.
    const { hitcount, sent } = track({ plugins: [pageviews(), traffic(), device()] });
    hitcount.track('later');
    const [landing, later] = sent;
    expect(landing.device).toEqual(later.device);
    expect(landing.traffic).toEqual(later.traffic);
  });

  it('builds a versioned event with page, device, utm and session context', () => {
    history.replaceState(null, '', '/pricing?utm_source=news&utm_campaign=launch');
    document.title = 'Pricing';
    const { hitcount, sent } = track({ site: 'demo' });
    hitcount.track('signup', { plan: 'pro' });

    const [event] = sent;
    expect(event).toMatchObject({
      schema: 1,
      name: 'signup',
      site: 'demo',
      props: { plan: 'pro' },
      page: { path: '/pricing', title: 'Pricing' },
      utm: { source: 'news', campaign: 'launch' },
    });
    expect(event.id).toMatch(UUID);
    expect(event.session).toMatch(UUID);
    expect(event.page.viewId).toMatch(UUID);
    // Contract changed on request: persist defaults to 'local', so every event carries a visitor id.
    expect(event.visitor).toMatch(UUID);
    expect(Date.parse(event.time)).not.toBeNaN();
    expect(event.device.timezone).toBeTruthy();
  });

  it('batches up to batchSize and flushes leftovers on a timer', () => {
    vi.useFakeTimers();
    const { hitcount, sent } = track({ batchSize: 3, flushIntervalMs: 1000 });
    hitcount.track('a');
    hitcount.track('b');
    expect(sent).toHaveLength(0);
    hitcount.track('c');
    expect(sent).toHaveLength(3);
    hitcount.track('d');
    vi.advanceTimersByTime(999);
    expect(sent).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(4);
  });

  it('flushes with unloading=true when the page is hidden', () => {
    const { hitcount, sent, metas } = track({ batchSize: 10 });
    hitcount.track('a');
    setVisibility('hidden');
    expect(sent).toHaveLength(1);
    expect(metas).toEqual([{ unloading: true }]);
  });

  it('registers every plugin before any setup runs, so enrichers see events fired during setup', () => {
    const boot: Plugin = { name: 'boot', setup: (hitcount) => hitcount.track('boot') };
    const tagger: Plugin = { name: 'tagger', enrich: (e) => ({ ...e, props: { ...e.props, tagged: true } }) };
    const { sent } = track({ plugins: [boot, tagger] });
    expect(sent[0].props.tagged).toBe(true);
  });

  it('lets beforeSend edit or drop events', () => {
    const { hitcount, sent } = track({
      beforeSend: (e) => (e.name === 'secret' ? null : { ...e, props: { ...e.props, edited: true } }),
    });
    hitcount.track('secret');
    hitcount.track('ok');
    expect(sent.map((e) => [e.name, e.props.edited])).toEqual([['ok', true]]);
  });

  it('drops an event when a plugin enrich returns null', () => {
    const dropper: Plugin = { name: 'dropper', enrich: (e) => (e.name === 'noise' ? null : e) };
    const { hitcount, names } = track({ plugins: [dropper] });
    hitcount.track('noise');
    hitcount.track('signal');
    expect(names()).toEqual(['signal']);
  });

  it('holds events while consent is pending and stores nothing until it is granted', () => {
    const { hitcount, sent } = track({ consent: 'pending', persist: 'local' });
    hitcount.track('early');
    expect(sent).toHaveLength(0);
    expect(localStorage.length).toBe(0);

    hitcount.consent('granted');
    expect(sent.map((e) => e.name)).toEqual(['early']);
    expect(sent[0].visitor).toBe(localStorage.getItem('_hitcount_v'));
  });

  it('keeps the visitor id in localStorage by default, so the next page load is the same visitor', () => {
    const first = track();
    first.hitcount.track('a');
    first.hitcount.destroy();
    const next = track();
    next.hitcount.track('b');

    expect(first.sent[0].visitor).toMatch(UUID);
    expect(next.sent[0].visitor).toBe(first.sent[0].visitor);
    expect(localStorage.getItem('_hitcount_v')).toBe(first.sent[0].visitor);
  });

  it('stamps a given visitorId on every event in every persist mode, without storing it', () => {
    for (const persist of ['memory', 'session', 'local', 'cookie'] as const) {
      const { hitcount, sent } = track({ persist, visitorId: 'srv.v1.abc' });
      hitcount.track('a');
      hitcount.reset();
      hitcount.track('b');
      expect(sent.map((e) => e.visitor)).toEqual(['srv.v1.abc', 'srv.v1.abc']);
      expect(hitcount.ids().visitor).toBe('srv.v1.abc');
      hitcount.destroy();
    }
    expect(localStorage.getItem('_hitcount_v')).toBeNull();
    expect(document.cookie).not.toContain('_hitcount_v');
  });

  it('stops tracking and wipes stored ids when consent is denied', () => {
    const { hitcount, sent } = track({ persist: 'local' });
    hitcount.track('before');
    expect(localStorage.getItem('_hitcount_v')).not.toBeNull();

    hitcount.consent('denied');
    hitcount.track('after');
    expect(sent.map((e) => e.name)).toEqual(['before']);
    expect(localStorage.getItem('_hitcount_v')).toBeNull();
    expect(hitcount.isEnabled()).toBe(false);
  });

  it('gives plugins a store that waits for consent and goes with reset() and denied consent', () => {
    const { hitcount } = track({ consent: 'pending', persist: 'local' });
    hitcount.store.set('note', 'early');
    expect(localStorage.length).toBe(0);

    hitcount.consent('granted');
    hitcount.store.set('note', 'kept');
    expect(localStorage.getItem('_hitcount_x_note')).toBe('kept');
    hitcount.reset();
    expect(localStorage.getItem('_hitcount_x_note')).toBeNull();

    hitcount.store.set('note', 'again');
    hitcount.consent('denied');
    expect(localStorage.getItem('_hitcount_x_note')).toBeNull();
    expect(hitcount.store.get('note')).toBeUndefined();
  });

  it('keeps the store in memory when persist is memory', () => {
    const { hitcount } = track({ persist: 'memory' });
    hitcount.store.set('note', 'kept');
    expect(hitcount.store.get('note')).toBe('kept');
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('_hitcount');
  });

  it('sends nothing after destroy(), even if consent is granted afterwards', () => {
    const { hitcount, sent } = track({ consent: 'pending' });
    hitcount.track('held');
    hitcount.destroy();
    hitcount.consent('granted');
    hitcount.flush();
    expect(sent).toHaveLength(0);
  });

  // Contract changed on request: privacy signals are ignored unless respectPrivacySignals is set.
  it('ignores Global Privacy Control by default and honours it when asked to', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    try {
      const byDefault = track();
      byDefault.hitcount.track('x');
      expect(byDefault.sent).toHaveLength(1);

      const respecting = track({ respectPrivacySignals: true });
      respecting.hitcount.track('x');
      expect(respecting.sent).toHaveLength(0);
      expect(respecting.hitcount.isEnabled()).toBe(false);
    } finally {
      Reflect.deleteProperty(navigator, 'globalPrivacyControl');
    }
  });

  it('waits for a prerendered page to be shown before tracking anything', () => {
    Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
    const { hitcount, sent } = track({ plugins: [pageviews()] });
    hitcount.track('early');
    expect(sent).toHaveLength(0);

    Object.defineProperty(document, 'prerendering', { value: false, configurable: true });
    document.dispatchEvent(new Event('prerenderingchange'));
    expect(sent.map((e) => e.name).sort()).toEqual(['early', 'pageview']);
    Reflect.deleteProperty(document, 'prerendering');
  });

  it('adds super props from set() and removes them with undefined', () => {
    const { hitcount, sent } = track();
    hitcount.set({ plan: 'pro', variant: 'b' });
    hitcount.track('a', { variant: 'override' });
    hitcount.set({ plan: undefined });
    hitcount.track('b');
    expect(sent[0].props).toEqual({ plan: 'pro', variant: 'override' });
    expect(sent[1].props).toEqual({ variant: 'b' });
  });

  it('stamps the identified user on later events until reset()', () => {
    const { hitcount, sent } = track();
    hitcount.identify('u_1', { plan: 'pro' });
    hitcount.track('after');
    hitcount.reset();
    hitcount.track('anonymous');

    expect(sent[0]).toMatchObject({ name: 'identify', user: 'u_1', props: { plan: 'pro' } });
    expect(sent[1].user).toBe('u_1');
    expect(sent[2].user).toBeUndefined();
    expect(sent[2].session).not.toBe(sent[1].session);
  });

  it('chains SPA referrers, starts a new viewId and fires leave on page()', () => {
    const { hitcount, sent } = track();
    const leave = vi.fn();
    hitcount.on('leave', leave);
    history.replaceState(null, '', '/a');
    hitcount.page();
    history.pushState(null, '', '/b');
    hitcount.page();

    const [a, b] = sent;
    expect(leave).toHaveBeenCalledTimes(1);
    expect(b.page.path).toBe('/b');
    expect(b.page.referrer).toBe(a.page.url);
    expect(b.page.viewId).not.toBe(a.page.viewId);
  });

  it('reports sink failures through onError without throwing or starving other sinks', async () => {
    const onError = vi.fn();
    const { hitcount, sent } = track({
      // Failed batches are retried first since the retry outbox (test/queue.test.ts); 0 reports at once.
      maxRetries: 0,
      onError,
      sinks: [
        { name: 'throws', send: () => { throw new Error('boom'); } },
        { name: 'rejects', send: () => Promise.reject(new Error('nope')) },
      ],
    });
    expect(() => hitcount.track('a')).not.toThrow();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(sent).toHaveLength(1);
    expect(onError.mock.calls.map((call) => call[1])).toEqual(['sink:throws', 'sink:rejects']);
  });

  it('rejects an empty event name through onError', () => {
    const onError = vi.fn();
    const { hitcount, sent } = track({ onError });
    hitcount.track('');
    expect(sent).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), 'track');
  });

  it('sends urls and titles exactly as they are by default', () => {
    history.replaceState(null, '', '/u/jane@example.com?token=abc#access_token=xyz');
    document.title = 'Inbox jane@example.com';
    const { hitcount, sent } = track();
    hitcount.page();
    expect(sent[0].page).toMatchObject({
      url: location.href,
      path: '/u/jane@example.com',
      title: 'Inbox jane@example.com',
    });
  });
});
