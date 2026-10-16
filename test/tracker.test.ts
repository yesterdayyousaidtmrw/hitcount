import { describe, expect, it, vi } from 'vitest';
import { pageviews } from '../src/plugins/pageviews';
import type { Plugin } from '../src/types';
import { setVisibility, track } from './helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createAnaly', () => {
  it('builds a versioned event with page, device, utm and session context', () => {
    history.replaceState(null, '', '/pricing?utm_source=news&utm_campaign=launch');
    document.title = 'Pricing';
    const { analy, sent } = track({ site: 'demo' });
    analy.track('signup', { plan: 'pro' });

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
    const { analy, sent } = track({ batchSize: 3, flushIntervalMs: 1000 });
    analy.track('a');
    analy.track('b');
    expect(sent).toHaveLength(0);
    analy.track('c');
    expect(sent).toHaveLength(3);
    analy.track('d');
    vi.advanceTimersByTime(999);
    expect(sent).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(4);
  });

  it('flushes with unloading=true when the page is hidden', () => {
    const { analy, sent, metas } = track({ batchSize: 10 });
    analy.track('a');
    setVisibility('hidden');
    expect(sent).toHaveLength(1);
    expect(metas).toEqual([{ unloading: true }]);
  });

  it('registers every plugin before any setup runs, so enrichers see events fired during setup', () => {
    const boot: Plugin = { name: 'boot', setup: (analy) => analy.track('boot') };
    const tagger: Plugin = { name: 'tagger', enrich: (e) => ({ ...e, props: { ...e.props, tagged: true } }) };
    const { sent } = track({ plugins: [boot, tagger] });
    expect(sent[0].props.tagged).toBe(true);
  });

  it('lets beforeSend edit or drop events', () => {
    const { analy, sent } = track({
      beforeSend: (e) => (e.name === 'secret' ? null : { ...e, props: { ...e.props, edited: true } }),
    });
    analy.track('secret');
    analy.track('ok');
    expect(sent.map((e) => [e.name, e.props.edited])).toEqual([['ok', true]]);
  });

  it('drops an event when a plugin enrich returns null', () => {
    const dropper: Plugin = { name: 'dropper', enrich: (e) => (e.name === 'noise' ? null : e) };
    const { analy, names } = track({ plugins: [dropper] });
    analy.track('noise');
    analy.track('signal');
    expect(names()).toEqual(['signal']);
  });

  it('holds events while consent is pending and stores nothing until it is granted', () => {
    const { analy, sent } = track({ consent: 'pending', persist: 'local' });
    analy.track('early');
    expect(sent).toHaveLength(0);
    expect(localStorage.length).toBe(0);

    analy.consent('granted');
    expect(sent.map((e) => e.name)).toEqual(['early']);
    expect(sent[0].visitor).toBe(localStorage.getItem('_analy_v'));
  });

  it('keeps the visitor id in localStorage by default, so the next page load is the same visitor', () => {
    const first = track();
    first.analy.track('a');
    first.analy.destroy();
    const next = track();
    next.analy.track('b');

    expect(first.sent[0].visitor).toMatch(UUID);
    expect(next.sent[0].visitor).toBe(first.sent[0].visitor);
    expect(localStorage.getItem('_analy_v')).toBe(first.sent[0].visitor);
  });

  it('stamps a given visitorId on every event in every persist mode, without storing it', () => {
    for (const persist of ['memory', 'session', 'local', 'cookie'] as const) {
      const { analy, sent } = track({ persist, visitorId: 'srv.v1.abc' });
      analy.track('a');
      analy.reset();
      analy.track('b');
      expect(sent.map((e) => e.visitor)).toEqual(['srv.v1.abc', 'srv.v1.abc']);
      expect(analy.ids().visitor).toBe('srv.v1.abc');
      analy.destroy();
    }
    expect(localStorage.getItem('_analy_v')).toBeNull();
    expect(document.cookie).not.toContain('_analy_v');
  });

  it('stops tracking and wipes stored ids when consent is denied', () => {
    const { analy, sent } = track({ persist: 'local' });
    analy.track('before');
    expect(localStorage.getItem('_analy_v')).not.toBeNull();

    analy.consent('denied');
    analy.track('after');
    expect(sent.map((e) => e.name)).toEqual(['before']);
    expect(localStorage.getItem('_analy_v')).toBeNull();
    expect(analy.isEnabled()).toBe(false);
  });

  it('gives plugins a store that waits for consent and goes with reset() and denied consent', () => {
    const { analy } = track({ consent: 'pending', persist: 'local' });
    analy.store.set('note', 'early');
    expect(localStorage.length).toBe(0);

    analy.consent('granted');
    analy.store.set('note', 'kept');
    expect(localStorage.getItem('_analy_x_note')).toBe('kept');
    analy.reset();
    expect(localStorage.getItem('_analy_x_note')).toBeNull();

    analy.store.set('note', 'again');
    analy.consent('denied');
    expect(localStorage.getItem('_analy_x_note')).toBeNull();
    expect(analy.store.get('note')).toBeUndefined();
  });

  it('keeps the store in memory when persist is memory', () => {
    const { analy } = track({ persist: 'memory' });
    analy.store.set('note', 'kept');
    expect(analy.store.get('note')).toBe('kept');
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('_analy');
  });

  it('sends nothing after destroy(), even if consent is granted afterwards', () => {
    const { analy, sent } = track({ consent: 'pending' });
    analy.track('held');
    analy.destroy();
    analy.consent('granted');
    analy.flush();
    expect(sent).toHaveLength(0);
  });

  // Contract changed on request: privacy signals are ignored unless respectPrivacySignals is set.
  it('ignores Global Privacy Control by default and honours it when asked to', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    try {
      const byDefault = track();
      byDefault.analy.track('x');
      expect(byDefault.sent).toHaveLength(1);

      const respecting = track({ respectPrivacySignals: true });
      respecting.analy.track('x');
      expect(respecting.sent).toHaveLength(0);
      expect(respecting.analy.isEnabled()).toBe(false);
    } finally {
      Reflect.deleteProperty(navigator, 'globalPrivacyControl');
    }
  });

  it('waits for a prerendered page to be shown before tracking anything', () => {
    Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
    const { analy, sent } = track({ plugins: [pageviews()] });
    analy.track('early');
    expect(sent).toHaveLength(0);

    Object.defineProperty(document, 'prerendering', { value: false, configurable: true });
    document.dispatchEvent(new Event('prerenderingchange'));
    expect(sent.map((e) => e.name).sort()).toEqual(['early', 'pageview']);
    Reflect.deleteProperty(document, 'prerendering');
  });

  it('adds super props from set() and removes them with undefined', () => {
    const { analy, sent } = track();
    analy.set({ plan: 'pro', variant: 'b' });
    analy.track('a', { variant: 'override' });
    analy.set({ plan: undefined });
    analy.track('b');
    expect(sent[0].props).toEqual({ plan: 'pro', variant: 'override' });
    expect(sent[1].props).toEqual({ variant: 'b' });
  });

  it('stamps the identified user on later events until reset()', () => {
    const { analy, sent } = track();
    analy.identify('u_1', { plan: 'pro' });
    analy.track('after');
    analy.reset();
    analy.track('anonymous');

    expect(sent[0]).toMatchObject({ name: 'identify', user: 'u_1', props: { plan: 'pro' } });
    expect(sent[1].user).toBe('u_1');
    expect(sent[2].user).toBeUndefined();
    expect(sent[2].session).not.toBe(sent[1].session);
  });

  it('chains SPA referrers, starts a new viewId and fires leave on page()', () => {
    const { analy, sent } = track();
    const leave = vi.fn();
    analy.on('leave', leave);
    history.replaceState(null, '', '/a');
    analy.page();
    history.pushState(null, '', '/b');
    analy.page();

    const [a, b] = sent;
    expect(leave).toHaveBeenCalledTimes(1);
    expect(b.page.path).toBe('/b');
    expect(b.page.referrer).toBe(a.page.url);
    expect(b.page.viewId).not.toBe(a.page.viewId);
  });

  it('reports sink failures through onError without throwing or starving other sinks', async () => {
    const onError = vi.fn();
    const { analy, sent } = track({
      onError,
      sinks: [
        { name: 'throws', send: () => { throw new Error('boom'); } },
        { name: 'rejects', send: () => Promise.reject(new Error('nope')) },
      ],
    });
    expect(() => analy.track('a')).not.toThrow();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(sent).toHaveLength(1);
    expect(onError.mock.calls.map((call) => call[1])).toEqual(['sink:throws', 'sink:rejects']);
  });

  it('rejects an empty event name through onError', () => {
    const onError = vi.fn();
    const { analy, sent } = track({ onError });
    analy.track('');
    expect(sent).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), 'track');
  });

  it('sends urls and titles exactly as they are by default', () => {
    history.replaceState(null, '', '/u/jane@example.com?token=abc#access_token=xyz');
    document.title = 'Inbox jane@example.com';
    const { analy, sent } = track();
    analy.page();
    expect(sent[0].page).toMatchObject({
      url: location.href,
      path: '/u/jane@example.com',
      title: 'Inbox jane@example.com',
    });
  });
});
