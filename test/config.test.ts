import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_RULES } from '../src/script/config';
import type { Hitcount, HitcountEvent } from '../src/types';

// Spies that call through, so the tests can see exactly what each config source reached.
vi.mock('../src/core/tracker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/tracker')>();
  return { ...actual, createHitcount: vi.fn(actual.createHitcount) };
});
vi.mock('../src/sinks/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sinks/http')>();
  return { ...actual, http: vi.fn(actual.http) };
});
vi.mock('../src/plugins/media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/plugins/media')>();
  return { ...actual, media: vi.fn(actual.media) };
});

interface Sources {
  /** data-* attributes, by their full attribute name. */
  attributes?: Record<string, string>;
  /** The <script type="application/json" id="hitcount-config"> text, or a value to JSON.stringify. */
  json?: unknown;
  /** window.hitcountConfig. */
  global?: unknown;
  build?: 'lite' | 'full';
}

async function bootWith({ attributes = {}, json, global, build = 'full' }: Sources) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const script = document.createElement('script');
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
  if (json !== undefined) {
    const block = document.createElement('script');
    block.type = 'application/json';
    block.id = 'hitcount-config';
    block.textContent = typeof json === 'string' ? json : JSON.stringify(json);
    document.body.append(block);
  }
  if (global !== undefined) window.hitcountConfig = global;
  const seen: HitcountEvent[] = [];
  window.hitcount = Object.assign(() => undefined, { q: [['on', 'event', (e: HitcountEvent) => seen.push(e)]] });

  vi.resetModules();
  if (build === 'full') await import('../src/script/full');
  else await import('../src/script/lite');
  const { createHitcount } = await import('../src/core/tracker');
  const { http } = await import('../src/sinks/http');
  const { media } = await import('../src/plugins/media');
  return {
    seen,
    fetchMock,
    warn,
    hitcount: window.hitcount as unknown as Hitcount,
    options: vi.mocked(createHitcount).mock.calls[0][0]!,
    http: vi.mocked(http),
    media: vi.mocked(media),
  };
}

afterEach(() => {
  (window.hitcount as unknown as Hitcount | undefined)?.destroy();
  delete window.hitcount;
  delete window.hitcountConfig;
  Reflect.deleteProperty(document, 'currentScript');
});

describe('script-tag config sources', () => {
  it('merges data-* attributes, then the JSON block, then window.hitcountConfig, later winning key by key', async () => {
    const { seen, options, http } = await bootWith({
      attributes: { 'data-site': 'from-data', 'data-endpoint': 'https://data.test/e', 'data-persist': 'memory' },
      json: { site: 'from-json', batchSize: 2 },
      global: { site: 'from-window' },
    });
    expect(options).toMatchObject({ site: 'from-window', persist: 'memory', batchSize: 2 });
    expect(http).toHaveBeenCalledWith('https://data.test/e', expect.anything());
    expect(seen[0].site).toBe('from-window');
  });

  it('passes every key on: tracker options to createHitcount, sink options to http, plugin options to the factory', async () => {
    const beforeSend = (event: HitcountEvent) => event;
    const onError = () => {};
    const { options, http, media, warn } = await bootWith({
      json: {
        site: 'blog',
        endpoint: 'https://collect.example.com/e',
        format: 'events',
        compress: true,
        headers: { 'x-key': 'k' },
        persist: 'local',
        consent: 'pending',
        cookieDomain: '.example.com',
        visitorId: 'v1',
        respectPrivacySignals: true,
        sessionTimeoutMinutes: 30,
        batchSize: 10,
        flushIntervalMs: 5000,
        maxRetries: 5,
        debug: true,
        plugins: { media: { milestones: [10, 50, 90] }, fingerprint: false, search: true },
      },
      global: { beforeSend, onError },
    });
    expect(options).toEqual({
      site: 'blog',
      sinks: [expect.objectContaining({ name: 'http' })],
      persist: 'local',
      consent: 'pending',
      cookieDomain: '.example.com',
      visitorId: 'v1',
      respectPrivacySignals: true,
      sessionTimeoutMinutes: 30,
      batchSize: 10,
      flushIntervalMs: 5000,
      maxRetries: 5,
      debug: true,
      beforeSend,
      onError,
    });
    expect(http).toHaveBeenCalledWith('https://collect.example.com/e', { format: 'events', compress: true, headers: { 'x-key': 'k' } });
    expect(media).toHaveBeenCalledWith({ milestones: [10, 50, 90] });
    expect(warn).not.toHaveBeenCalled();
  });

  it('takes functions from window.hitcountConfig: beforeSend, onError and a format function', async () => {
    const onError = vi.fn();
    const { fetchMock, seen, hitcount } = await bootWith({
      attributes: { 'data-endpoint': 'https://collect.test/e' },
      global: {
        beforeSend: (event: HitcountEvent) => ({ ...event, props: { ...event.props, via: 'window' } }),
        format: (events: HitcountEvent[]) => ({ names: events.map((e) => e.name) }),
        onError,
      },
    });
    hitcount.flush();
    expect(seen[0].props.via).toBe('window');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ names: ['pageview'] });

    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
    hitcount.track('after');
    hitcount.flush();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ retryable: false }), 'sink:http'));
  });

  it('reads the newer keys from data-* attributes too, numbers as numbers', async () => {
    const { fetchMock, options, hitcount } = await bootWith({
      attributes: { 'data-endpoint': 'https://collect.test/e', 'data-format': 'ndjson', 'data-batch-size': '1' },
    });
    hitcount.flush();
    expect(options.batchSize).toBe(1);
    expect(fetchMock.mock.calls[0][1].body).toMatch(/^\{"schema":1,.*\}\n$/);
  });
});

describe('plugins in the config', () => {
  it('an object turns plugins off with false and leaves every plugin it does not name at the build default', async () => {
    const { seen } = await bootWith({ build: 'lite', global: { plugins: { fingerprint: false } } });
    expect(seen[0]).toMatchObject({ name: 'pageview', traffic: { kind: 'automated' }, attribution: { channel: 'direct' } });
    expect(seen[0].fingerprint).toBeUndefined();
  });

  it('true turns a plugin on with its defaults, an options object passes those options to its factory', async () => {
    const { seen, media } = await bootWith({ global: { plugins: { errors: true, media: { milestones: [10] } } } });
    dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }));
    expect(seen.map((e) => e.name)).toContain('error');
    expect(media).toHaveBeenCalledWith({ milestones: [10] });
  });

  it('an array names exactly the plugins to run', async () => {
    const { seen } = await bootWith({ global: { plugins: ['pageviews', 'traffic'] } });
    expect(seen[0]).toMatchObject({ traffic: { kind: 'automated' } });
    expect(seen[0].attribution).toBeUndefined();
  });

  it('so does a comma string, as data-plugins takes it', async () => {
    const { seen } = await bootWith({ json: { plugins: 'pageviews, channels' } });
    expect(seen[0]).toMatchObject({ attribution: { channel: 'direct' } });
    expect(seen[0].traffic).toBeUndefined();
  });

  it('"all" runs every plugin in the build', async () => {
    const { media } = await bootWith({ json: { plugins: 'all' } });
    expect(media).toHaveBeenCalledWith();
  });

  it("carries any plugin's options through as they are, such as the funnels plugin's funnels", async () => {
    const funnels = vi.fn(() => ({ name: 'funnels' }));
    window.hitcountConfig = { plugins: { funnels: { funnels: { signup: ['/join', '/welcome'] } } } };
    // Silences the warnings this one-plugin registry earns: no endpoint, default plugins not in the build.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { boot } = await import('../src/script/boot');
    boot({ funnels });
    expect(funnels).toHaveBeenCalledWith({ funnels: { signup: ['/join', '/welcome'] } });
  });

  it('a later source edits the plugins an earlier one chose', async () => {
    const { seen } = await bootWith({ attributes: { 'data-plugins': 'pageviews' }, global: { plugins: { traffic: true } } });
    expect(seen[0]).toMatchObject({ traffic: { kind: 'automated' } });
    expect(seen[0].attribution).toBeUndefined();
  });

  it('warns about a named plugin the build does not have', async () => {
    const { warn } = await bootWith({ build: 'lite', global: { plugins: { heatmap: true } } });
    expect(warn).toHaveBeenCalledWith('[hitcount] plugins not in this build: heatmap (hitcount.full.min.js has them all)');
  });

  it("starts a plugin whose factory rejects the options with its defaults, so a privacy plugin is never silently off", async () => {
    const { seen, warn } = await bootWith({
      global: { plugins: { redact: { params: 5 } } },
      attributes: { 'data-plugins': 'pageviews,fingerprint' },
    });
    expect(warn).toHaveBeenCalledWith('[hitcount] plugins.redact options rejected, so it runs with its defaults:', expect.any(TypeError));
    expect(seen[0].name).toBe('pageview');
    expect(seen[0].fingerprint).toBeUndefined();
  });
});

describe('bad config warns and is ignored, never thrown', () => {
  it('a JSON block that does not parse: one warning, the other sources still apply', async () => {
    const { seen, warn } = await bootWith({ attributes: { 'data-site': 'from-data', 'data-debug': '' }, json: '{ "site": ' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[hitcount\] #hitcount-config is not valid JSON, ignored:/);
    expect(seen[0].site).toBe('from-data');
  });

  it('a source that is not an object', async () => {
    const { warn } = await bootWith({ json: '[1]', global: 'blog', attributes: { 'data-debug': '' } });
    expect(warn.mock.calls).toEqual([
      ['[hitcount] #hitcount-config should be an object, ignored'],
      ['[hitcount] window.hitcountConfig should be an object, ignored'],
    ]);
  });

  it('a wrong-typed value: one warning naming the key, and that key keeps its default', async () => {
    const { options, warn, seen } = await bootWith({
      attributes: { 'data-debug': '' },
      global: { batchSize: '10', persist: 'disk', headers: 'x-key: k', plugins: { media: 5 }, site: 'ok' },
    });
    expect(warn.mock.calls).toEqual([
      ['[hitcount] window.hitcountConfig batchSize should be number, ignored'],
      ['[hitcount] window.hitcountConfig persist should be memory|session|local|cookie, ignored'],
      ['[hitcount] window.hitcountConfig headers should be object, ignored'],
      ['[hitcount] window.hitcountConfig plugins.media should be true|false|object, ignored'],
    ]);
    expect(options).not.toHaveProperty('batchSize');
    expect(options).not.toHaveProperty('persist');
    expect(seen[0].site).toBe('ok');
  });

  it('a number that is not one, from a data-* attribute', async () => {
    const { warn, options } = await bootWith({ attributes: { 'data-debug': '', 'data-batch-size': 'ten' } });
    expect(warn.mock.calls).toEqual([['[hitcount] data-* attributes batchSize should be number, ignored']]);
    expect(options.batchSize).toBeUndefined();
  });

  it('unknown keys: one warning for all of them, across sources, inherited names included', async () => {
    const { warn } = await bootWith({
      attributes: { 'data-debug': '' },
      json: '{ "sit": "a", "constructor": 1, "__proto__": { "site": "x" } }',
      global: { sit: 'b', foo: 1 },
    });
    expect(warn.mock.calls).toEqual([['[hitcount] unknown config keys, ignored: sit, constructor, __proto__, foo']]);
  });

  it('an undefined value means not set, so a conditional key needs no guard', async () => {
    const { warn } = await bootWith({ attributes: { 'data-debug': '' }, global: { visitorId: undefined } });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the config shape', () => {
  it('names a rule for every key', () => {
    expect(Object.keys(CONFIG_RULES).sort()).toEqual(
      [
        'site', 'endpoint', 'format', 'compress', 'headers', 'persist', 'consent', 'cookieDomain', 'visitorId',
        'respectPrivacySignals', 'sessionTimeoutMinutes', 'batchSize', 'flushIntervalMs', 'maxRetries', 'debug',
        'beforeSend', 'onError', 'plugins',
      ].sort(),
    );
  });
});
