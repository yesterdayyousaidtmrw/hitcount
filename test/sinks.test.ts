import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http } from '../src/sinks/http';
import { toRow } from '../src/sinks/row';
import { supabase } from '../src/sinks/supabase';
import { postgresColumns, sampleEvent } from './helpers';

const ok = () => vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
const lastInit = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit;

afterEach(() => {
  Reflect.deleteProperty(navigator, 'sendBeacon');
});

describe('http sink', () => {
  it('POSTs the batch as text/plain JSON so no CORS preflight is needed', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    await http('https://c.test/e').send([sampleEvent()], { unloading: false });

    expect(fetchMock.mock.calls[0][0]).toBe('https://c.test/e');
    const init = lastInit(fetchMock);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      keepalive: true,
      credentials: 'omit',
    });
    expect(JSON.parse(init.body as string)).toEqual([sampleEvent()]);
  });

  it('rejects on a non-2xx response so onError hears about it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(http('https://c.test/e').send([sampleEvent()], { unloading: false })).rejects.toThrow('HTTP 500');
  });

  it('marks network errors, 408, 429 and 5xx retryable, and any other 4xx not', async () => {
    const sink = http('https://c.test/e');
    for (const [status, retryable] of [[400, false], [404, false], [408, true], [429, true], [500, true], [503, true]] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(sink.send([sampleEvent()], { unloading: false })).rejects.toMatchObject({ retryable });
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(sink.send([sampleEvent()], { unloading: false })).rejects.toMatchObject({ name: 'TypeError', retryable: true });
  });

  it('gzips the body when compress is on, still as text/plain so no preflight is needed', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    await http('https://c.test/e', { compress: true }).send([sampleEvent()], { unloading: false });

    const init = lastInit(fetchMock);
    expect(init.headers).toEqual({ 'content-type': 'text/plain' });
    const body = new Uint8Array(init.body as ArrayBuffer);
    expect([...body.slice(0, 2)]).toEqual([0x1f, 0x8b]);
    expect(JSON.parse(gunzipSync(body).toString())).toEqual([sampleEvent()]);
  });

  it('sends plain JSON while unloading even with compress on, since compressing may not finish in time', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    const beacon = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const sink = http('https://c.test/e', { compress: true });

    sink.send([sampleEvent()], { unloading: true });
    expect(JSON.parse(await (beacon.mock.calls[0][1] as Blob).text())).toEqual([sampleEvent()]);

    sink.send([sampleEvent()], { unloading: true });
    expect(JSON.parse(lastInit(fetchMock).body as string)).toEqual([sampleEvent()]);
  });

  it('sends plain JSON where the browser has no CompressionStream', () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('CompressionStream', undefined);
    http('https://c.test/e', { compress: true }).send([sampleEvent()], { unloading: false });
    expect(JSON.parse(lastInit(fetchMock).body as string)).toEqual([sampleEvent()]);
  });

  it('uses sendBeacon while unloading and falls back to fetch when the beacon is refused', () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    const beacon = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const sink = http('https://c.test/e');

    sink.send([sampleEvent()], { unloading: true });
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    sink.send([sampleEvent()], { unloading: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends custom headers with fetch even while unloading, because beacons cannot', () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });

    http('https://c.test/e', { headers: { 'x-key': 'k' } }).send([sampleEvent()], { unloading: true });
    expect(beacon).not.toHaveBeenCalled();
    expect(lastInit(fetchMock).headers).toEqual({ 'content-type': 'application/json', 'x-key': 'k' });
  });

  it('shapes the body with format()', () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    http('https://c.test/e', { format: (events) => ({ batch: events.map((e) => e.name) }) }).send(
      [sampleEvent()],
      { unloading: false },
    );
    expect(JSON.parse(lastInit(fetchMock).body as string)).toEqual({ batch: ['pageview'] });
  });

  it("format 'events' is the default body: the event array", () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    http('https://c.test/e', { format: 'events' }).send([sampleEvent()], { unloading: false });
    expect(lastInit(fetchMock).body).toBe(JSON.stringify([sampleEvent()]));
  });

  it("format 'rows' posts toRow() rows, still text/plain so no preflight is needed", () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    http('https://c.test/e', { format: 'rows' }).send([sampleEvent(), sampleEvent({ name: 'signup' })], { unloading: false });
    const init = lastInit(fetchMock);
    expect(init.headers).toEqual({ 'content-type': 'text/plain' });
    expect(JSON.parse(init.body as string)).toEqual([toRow(sampleEvent()), toRow(sampleEvent({ name: 'signup' }))]);
  });

  it("format 'ndjson' posts one event per line, each line ending in a newline", () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    const events = [sampleEvent(), sampleEvent({ name: 'signup' })];
    http('https://c.test/e', { format: 'ndjson' }).send(events, { unloading: false });
    const init = lastInit(fetchMock);
    expect(init.headers).toEqual({ 'content-type': 'text/plain' });
    expect(init.body).toBe(`${JSON.stringify(events[0])}\n${JSON.stringify(events[1])}\n`);
  });

  it('labels an ndjson body application/x-ndjson once headers force a preflight anyway', () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    http('https://c.test/e', { format: 'ndjson', headers: { 'x-key': 'k' } }).send([sampleEvent()], { unloading: false });
    expect(lastInit(fetchMock).headers).toEqual({ 'content-type': 'application/x-ndjson', 'x-key': 'k' });
  });

  it('gzips every preset when compress is on', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    const gunzipped = () => gunzipSync(new Uint8Array(lastInit(fetchMock).body as ArrayBuffer)).toString();
    await http('https://c.test/e', { format: 'rows', compress: true }).send([sampleEvent()], { unloading: false });
    expect(JSON.parse(gunzipped())).toEqual([toRow(sampleEvent())]);
    await http('https://c.test/e', { format: 'ndjson', compress: true }).send([sampleEvent()], { unloading: false });
    expect(gunzipped()).toBe(`${JSON.stringify(sampleEvent())}\n`);
  });
});

describe('toRow', () => {
  it('always emits the same keys, null when a value is missing', () => {
    const sparse = toRow(sampleEvent());
    const full = toRow(
      sampleEvent({
        site: 's',
        visitor: 'v',
        user: 'u',
        utm: { source: 'x' },
        traffic: { kind: 'human', signals: [] },
        fingerprint: { id: 'f'.repeat(32), scrambled: true, reasons: ['brave'] },
        page: { url: 'u', path: '/', title: 't', referrer: 'r', viewId: 'w' },
      }),
    );
    expect(Object.keys(sparse)).toEqual(Object.keys(full));
    expect(sparse).toMatchObject({ site: null, visitor_id: null, user_id: null, referrer: null, utm_source: null, traffic_kind: null });
    expect(sparse).toMatchObject({ fingerprint_id: null, fingerprint_scrambled: null, fingerprint_reasons: null });
    expect(full).toMatchObject({ fingerprint_id: 'f'.repeat(32), fingerprint_scrambled: true, fingerprint_reasons: ['brave'] });
  });

  it('matches the columns in schema/postgres.sql', () => {
    const columns = postgresColumns().filter((c) => c !== 'received_at');
    expect(Object.keys(toRow(sampleEvent()))).toEqual(columns);
  });

  it('stores visitor ids as text, because a server-issued visitorId need not be a uuid', () => {
    const sql = readFileSync('schema/postgres.sql', 'utf8');
    expect(sql).toMatch(/^ {2}visitor_id\s+text\b/m);
  });
});

describe('supabase sink', () => {
  // Not real keys: only their shape matters (legacy anon keys are JWTs and start with "eyJ").
  const jwtShaped = 'eyJ.fake';
  const publishable = 'sb_fake';

  it('inserts flat rows through the REST API with the key headers', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    await supabase({ url: 'https://p.supabase.co/', key: jwtShaped }).send([sampleEvent()], { unloading: false });

    expect(fetchMock.mock.calls[0][0]).toBe('https://p.supabase.co/rest/v1/analy_events');
    const init = lastInit(fetchMock);
    expect(init.headers).toMatchObject({ apikey: jwtShaped, authorization: `Bearer ${jwtShaped}`, prefer: 'return=minimal' });
    expect(JSON.parse(init.body as string)).toEqual([toRow(sampleEvent())]);
  });

  it('sends a non-JWT (publishable) key only as apikey', () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    supabase({ url: 'https://p.supabase.co', key: publishable, table: 'events' }).send([sampleEvent()], {
      unloading: false,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://p.supabase.co/rest/v1/events');
    expect(lastInit(fetchMock).headers).not.toHaveProperty('authorization');
  });
});
