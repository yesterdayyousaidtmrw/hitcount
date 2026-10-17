// @vitest-environment node
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it, vi } from 'vitest';
import { eventFromPixel, PIXEL_GIF, readBatch } from '../src/server';
import { http } from '../src/sinks/http';
import type { AnalyEvent } from '../src/types';

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validateEvent = ajv.compile(JSON.parse(readFileSync('schema/event.v1.json', 'utf8')));

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

function pixel(query: string, headers: Record<string, string> = {}) {
  return new Request(`https://collect.test/p.gif?${query}`, {
    headers: { 'user-agent': SAFARI, 'accept-language': 'en-GB,en;q=0.9', referer: 'https://blog.test/post?utm_source=chatgpt.com', ...headers },
  });
}

describe('eventFromPixel', () => {
  it('turns a pixel hit into a schema-valid event, page from the Referer and extra params as props', async () => {
    const event = await eventFromPixel(pixel('e=signup&site=blog&plan=pro'), { salt: 's', ip: '203.0.113.7' });
    expect(event).toMatchObject({
      name: 'signup',
      site: 'blog',
      page: { url: 'https://blog.test/post?utm_source=chatgpt.com', path: '/post', title: '' },
      device: { language: 'en-GB', browser: 'Safari', os: 'iOS', deviceType: 'mobile', screen: '0x0' },
      utm: { source: 'chatgpt.com' },
      source: { channel: 'ai', name: 'chatgpt.com' },
      traffic: { kind: 'unknown', signals: [] },
      props: { plan: 'pro' },
    });
    expect(validateEvent(event)).toBe(true);
  });

  it('gives the same visitor the same session all day, and a different one a different session', async () => {
    const a = await eventFromPixel(pixel('site=blog'), { ip: '203.0.113.7' });
    const b = await eventFromPixel(pixel('e=read&site=blog'), { ip: '203.0.113.7' });
    const other = await eventFromPixel(pixel('site=blog'), { ip: '198.51.100.9' });
    expect(b.session).toBe(a.session);
    expect(b.page.viewId).toBe(a.page.viewId);
    expect(other.session).not.toBe(a.session);
  });

  it('classifies crawlers from the user agent and keeps Cloudflare country', async () => {
    const event = await eventFromPixel(pixel('', { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2)', 'cf-ipcountry': 'GB' }));
    expect(event.traffic?.kind).toBe('ai-agent');
    expect(event.props.country).toBe('GB');
  });

  it('still counts a hit with no Referer', async () => {
    const event = await eventFromPixel(new Request('https://collect.test/p.gif?site=blog'));
    expect(event.page).toMatchObject({ url: '', path: '' });
    expect(validateEvent(event)).toBe(true);
  });

  it('ships a valid 1x1 GIF', () => {
    expect(new TextDecoder().decode(PIXEL_GIF.slice(0, 6))).toBe('GIF89a');
  });
});

describe('readBatch', () => {
  const batch = [{ schema: 1, id: 'e1', name: 'pageview', props: { plan: 'pro' } }];
  const post = (body: BodyInit) =>
    new Request('https://collect.test/collect', { method: 'POST', body, headers: { 'content-type': 'text/plain' } });

  it('reads a plain JSON body', async () => {
    expect(await readBatch(post(JSON.stringify(batch)))).toEqual(batch);
  });

  it('reads a gzipped body, recognised by its first two bytes', async () => {
    expect(await readBatch(post(gzipSync(JSON.stringify(batch))))).toEqual(batch);
  });

  it('reads exactly what http({ compress: true }) sends', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await http('https://collect.test/collect', { compress: true }).send([batch[0] as unknown as AnalyEvent], { unloading: false });
    const { body } = fetchMock.mock.calls[0][1] as RequestInit;
    expect([...new Uint8Array(body as ArrayBuffer).slice(0, 2)]).toEqual([0x1f, 0x8b]);
    expect(await readBatch(post(body as ArrayBuffer))).toEqual(batch);
  });

  it('rejects a body that is not JSON', async () => {
    await expect(readBatch(post('not json'))).rejects.toThrow(SyntaxError);
  });
});
