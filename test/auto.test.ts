import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Analy, AnalyEvent } from '../src/types';

afterEach(() => {
  (window.analy as unknown as Analy | undefined)?.destroy();
  delete window.analy;
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
    window.analy = Object.assign(() => undefined, {
      q: [
        ['set', { plan: 'pro' }],
        ['track', 'queued'],
      ],
    });

    vi.resetModules();
    await import('../src/script/full');
    window.analy!('track', 'after');
    (window.analy as unknown as Analy).flush();

    expect(fetchMock.mock.calls[0][0]).toBe('https://collect.test/e');
    const events: AnalyEvent[] = fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body));
    expect(events.map((e) => e.name)).toEqual(['queued', 'pageview', 'after']);
    expect(events.every((e) => e.site === 'demo' && e.props.plan === 'pro')).toBe(true);
    expect(warn).toHaveBeenCalledWith('[analy] plugins not in this build: nope (analy.full.min.js has them all)');
  });

  it('stamps data-visitor-id on every event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const script = document.createElement('script');
    script.setAttribute('data-endpoint', 'https://collect.test/e');
    script.setAttribute('data-visitor-id', 'srv.v1.abc');
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    const seen: AnalyEvent[] = [];
    window.analy = Object.assign(() => undefined, { q: [['on', 'event', (e: AnalyEvent) => seen.push(e)]] });

    vi.resetModules();
    await import('../src/script/lite');
    window.analy!('track', 'after');

    expect(seen.map((e) => [e.name, e.visitor])).toEqual([
      ['pageview', 'srv.v1.abc'],
      ['after', 'srv.v1.abc'],
    ]);
  });

  it('the lite build runs the default plugins and points to the full build for the rest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const script = document.createElement('script');
    Object.assign(script.dataset, { endpoint: 'https://collect.test/e', plugins: 'pageviews,traffic,heatmap' });
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
    const seen: AnalyEvent[] = [];
    window.analy = Object.assign(() => undefined, { q: [['on', 'event', (e: AnalyEvent) => seen.push(e)]] });

    vi.resetModules();
    await import('../src/script/lite');

    expect(seen.map((e) => [e.name, e.traffic?.kind])).toEqual([['pageview', 'unknown']]);
    expect(warn).toHaveBeenCalledWith('[analy] plugins not in this build: heatmap (analy.full.min.js has them all)');
  });
});
