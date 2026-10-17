import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hitcount, HitcountEvent } from '../src/types';

afterEach(() => {
  (window.hitcount as unknown as Hitcount | undefined)?.destroy();
  delete window.hitcount;
  Reflect.deleteProperty(document, 'currentScript');
});

describe('script-tag bootstrap', () => {
  it('reads data attributes, replays the pre-load queue first and exposes a callable API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const script = document.createElement('script');
    Object.assign(script.dataset, { site: 'demo', endpoint: 'https://collect.test/e', plugins: 'pageviews, nope' });
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    window.hitcount = Object.assign(() => undefined, {
      q: [
        ['set', { plan: 'pro' }],
        ['track', 'queued'],
      ],
    });

    vi.resetModules();
    await import('../src/script/full');
    window.hitcount!('track', 'after');
    (window.hitcount as unknown as Hitcount).flush();

    expect(fetchMock.mock.calls[0][0]).toBe('https://collect.test/e');
    const events: HitcountEvent[] = fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body));
    expect(events.map((e) => e.name)).toEqual(['queued', 'pageview', 'after']);
    expect(events.every((e) => e.site === 'demo' && e.props.plan === 'pro')).toBe(true);
    expect(warn).toHaveBeenCalledWith('[hitcount] plugins not in this build: nope (hitcount.full.min.js has them all)');
  });

  it('stamps data-visitor-id on every event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const script = document.createElement('script');
    script.setAttribute('data-endpoint', 'https://collect.test/e');
    script.setAttribute('data-visitor-id', 'srv.v1.abc');
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    const seen: HitcountEvent[] = [];
    window.hitcount = Object.assign(() => undefined, { q: [['on', 'event', (e: HitcountEvent) => seen.push(e)]] });

    vi.resetModules();
    await import('../src/script/lite');
    window.hitcount!('track', 'after');

    expect(seen.map((e) => [e.name, e.visitor])).toEqual([
      ['pageview', 'srv.v1.abc'],
      ['after', 'srv.v1.abc'],
    ]);
  });

  it('by default stores a visitor id and fingerprints the device on every event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const script = document.createElement('script');
    script.setAttribute('data-endpoint', 'https://collect.test/e');
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    const seen: HitcountEvent[] = [];
    window.hitcount = Object.assign(() => undefined, { q: [['on', 'event', (e: HitcountEvent) => seen.push(e)]] });

    vi.resetModules();
    await import('../src/script/lite');
    window.hitcount!('track', 'after');

    const visitor = localStorage.getItem('_hitcount_v');
    expect(visitor).toBeTruthy();
    expect(seen.map((e) => [e.name, e.visitor])).toEqual([
      ['pageview', visitor],
      ['after', visitor],
    ]);
    expect(seen.map((e) => e.fingerprint?.id)).toEqual([expect.stringMatching(/^[0-9a-f]{32}$/), seen[0].fingerprint?.id]);
  });

  it('gzips the batches with data-compress', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const script = document.createElement('script');
    script.setAttribute('data-endpoint', 'https://collect.test/e');
    script.setAttribute('data-compress', '');
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });

    vi.resetModules();
    await import('../src/script/lite');
    (window.hitcount as unknown as Hitcount).flush();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ 'content-type': 'text/plain' });
    expect([...new Uint8Array(init.body).slice(0, 2)]).toEqual([0x1f, 0x8b]);
    expect(JSON.parse(gunzipSync(new Uint8Array(init.body)).toString())[0].name).toBe('pageview');
  });

  it('the lite build runs the default plugins and points to the full build for the rest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const script = document.createElement('script');
    Object.assign(script.dataset, { endpoint: 'https://collect.test/e', plugins: 'pageviews,traffic,heatmap' });
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    const seen: HitcountEvent[] = [];
    window.hitcount = Object.assign(() => undefined, { q: [['on', 'event', (e: HitcountEvent) => seen.push(e)]] });

    vi.resetModules();
    await import('../src/script/lite');

    // happy-dom reports navigator.webdriver, and the landing page view now sees it (it is held until every setup has run).
    expect(seen.map((e) => [e.name, e.traffic?.kind])).toEqual([['pageview', 'automated']]);
    expect(warn).toHaveBeenCalledWith('[hitcount] plugins not in this build: heatmap (hitcount.full.min.js has them all)');
  });

  it('data-funnels turns on the funnels plugin with the funnels it declares', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    history.replaceState(null, '', '/pricing');
    const script = document.createElement('script');
    script.setAttribute('data-endpoint', 'https://collect.test/e');
    script.setAttribute('data-funnels', '{"signup":["/pricing","/signup","signup_completed"]}');
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    const seen: HitcountEvent[] = [];
    window.hitcount = Object.assign(() => undefined, { q: [['on', 'event', (e: HitcountEvent) => seen.push(e)]] });

    vi.resetModules();
    await import('../src/script/full');
    await Promise.resolve();

    expect(seen.map((e) => e.name)).toEqual(['pageview', 'funnel_step']);
    expect(seen[1].props).toMatchObject({ funnel: 'signup', step: 1, stepName: '/pricing', steps: 3 });
  });

  it('data-funnels that is not JSON warns once and tracks no funnels', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    history.replaceState(null, '', '/pricing');
    const script = document.createElement('script');
    Object.assign(script.dataset, { endpoint: 'https://collect.test/e', funnels: "{signup:['/pricing']}" });
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    const seen: HitcountEvent[] = [];
    window.hitcount = Object.assign(() => undefined, { q: [['on', 'event', (e: HitcountEvent) => seen.push(e)]] });

    vi.resetModules();
    await import('../src/script/full');
    await Promise.resolve();

    expect(seen.map((e) => e.name)).toEqual(['pageview']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[hitcount] data-funnels is not valid JSON, so no funnels are tracked');
  });

  it('data-funnels on the lite build points to the full build', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const script = document.createElement('script');
    Object.assign(script.dataset, { endpoint: 'https://collect.test/e', funnels: '{"signup":["/pricing"]}' });
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });

    vi.resetModules();
    await import('../src/script/lite');

    expect(warn).toHaveBeenCalledWith('[hitcount] plugins not in this build: funnels (hitcount.full.min.js has them all)');
  });
});
