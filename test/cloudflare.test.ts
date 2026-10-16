import { describe, expect, it, vi } from 'vitest';
import { cloudflare, parseTrace } from '../src/plugins/cloudflare';
import { track } from './helpers';

const TRACE = 'fl=29f1\nh=example.com\nip=203.0.113.7\nts=1760000000.1\nvisit_scheme=https\nuag=Mozilla/5.0\ncolo=LHR\nsliver=none\nhttp=http/3\nloc=GB\ntls=TLSv1.3\nsni=plaintext\nwarp=off\ngateway=off\n';

const trace = (body: string, status = 200) => vi.fn().mockResolvedValue(new Response(body, { status }));

describe('parseTrace', () => {
  it('keeps the documented fields under readable names', () => {
    expect(parseTrace(TRACE)).toEqual({ ip: '203.0.113.7', colo: 'LHR', http: 'http/3', country: 'GB', tls: 'TLSv1.3', warp: 'off' });
  });
});

describe('cloudflare plugin', () => {
  it('sends one cloudflare event per session', async () => {
    const fetchMock = trace(TRACE);
    vi.stubGlobal('fetch', fetchMock);
    const first = track({ plugins: [cloudflare()] });
    await vi.waitFor(() => expect(first.sent).toHaveLength(1));
    expect(first.sent[0]).toMatchObject({ name: 'cloudflare', props: { country: 'GB', colo: 'LHR', ip: '203.0.113.7' } });
    expect(fetchMock).toHaveBeenCalledWith('/cdn-cgi/trace', { credentials: 'omit' });

    track({ plugins: [cloudflare()] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks clearance when the cf_clearance cookie is readable', async () => {
    vi.stubGlobal('fetch', trace(TRACE));
    document.cookie = 'cf_clearance=abc;path=/';
    const { sent } = track({ plugins: [cloudflare()] });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].props.clearance).toBe(true);
  });

  it('does nothing on a site that is not behind Cloudflare', async () => {
    const fetchMock = trace('Not Found', 404);
    vi.stubGlobal('fetch', fetchMock);
    const { sent } = track({ plugins: [cloudflare()] });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toHaveLength(0);
  });
});
