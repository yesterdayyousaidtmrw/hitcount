// Server side of the HTML-only setup: turns a pixel or CSS image request into a normal analy event,
// so pages without JavaScript land in the same table as the script. readBatch() reads what the http()
// sink posts. Needs only the Fetch API Request: Node 18+, Cloudflare Workers, Deno, Bun.
import { utmFrom } from './core/context';
import { uid } from './core/uid';
import { classifySource } from './plugins/channels';
import { parseUserAgent } from './plugins/device';
import { classifyUserAgent } from './plugins/traffic';
import type { AnalyEvent, Props } from './types';

/** A 1×1 transparent GIF to answer pixel requests with. */
export const PIXEL_GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
export const PIXEL_HEADERS = { 'content-type': 'image/gif', 'cache-control': 'no-store, max-age=0' };

// Query params with a meaning of their own; every other param becomes a prop.
const RESERVED = new Set(['e', 'site', 'u']);

export interface PixelOptions {
  /** Secret mixed into the daily visitor hash so it cannot be recomputed from IP + UA alone. */
  salt?: string;
  /** Visitor IP (CF-Connecting-IP, X-Forwarded-For…). Only used inside the hash, never stored. */
  ip?: string;
}

const toUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    // No Referer (or a stripped one): the event still counts, without a page URL.
    return undefined;
  }
};

/** A stable uuid-shaped id from a string: the same visitor on the same day gets the same session. */
async function hashId(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Builds an event from a GET such as /p.gif?e=pageview&site=blog&plan=pro.
 * e is the event name (default pageview), u overrides the page URL (default: the Referer header,
 * so give the <img> referrerpolicy="unsafe-url"), and every other param becomes a prop.
 * No JavaScript means no screen size, timezone or original referrer: those fields are empty.
 */
export async function eventFromPixel(request: Request, { salt = '', ip = '' }: PixelOptions = {}): Promise<AnalyEvent> {
  const params = new URL(request.url).searchParams;
  const { headers } = request;
  const pageUrl = params.get('u') || headers.get('referer') || '';
  const page = toUrl(pageUrl);
  const site = params.get('site') ?? undefined;
  const userAgent = headers.get('user-agent') ?? '';
  const utm = page ? utmFrom(page.search) : undefined;
  const day = new Date().toISOString().slice(0, 10);
  const session = await hashId(`${salt}|${site ?? ''}|${ip}|${userAgent}|${day}`);

  const props: Props = {};
  params.forEach((value, key) => {
    if (!RESERVED.has(key)) props[key] = value;
  });
  const country = headers.get('cf-ipcountry');
  if (country) props.country = country;

  return {
    schema: 1,
    id: uid(),
    name: params.get('e') || 'pageview',
    time: new Date().toISOString(),
    site,
    session,
    // Same session + same page = same view, so a page's pageview and its lazy "read" pixel line up.
    page: { url: pageUrl, path: page?.pathname ?? '', title: '', viewId: await hashId(`${session}|${pageUrl}`) },
    device: {
      language: (headers.get('accept-language') ?? '').split(',')[0],
      timezone: '',
      screen: '0x0',
      viewport: '0x0',
      touch: headers.get('sec-ch-ua-mobile') === '?1',
      userAgent,
      ...parseUserAgent(userAgent),
    },
    utm,
    source: utm ? classifySource(undefined, utm, page?.hostname ?? '') : undefined,
    traffic: classifyUserAgent(userAgent),
    props,
  };
}

/**
 * Reads a batch the http() sink posted, in any format: the array for 'events' and 'rows' (JSON) and
 * for 'ndjson' (one event per line), and a format() function's body as the JSON it is. Plain, or gzip
 * when it was made with { compress: true } (data-compress). The content type says none of this, so
 * gzip is told apart by its first two bytes, 1f 8b, and NDJSON by a line break outside a JSON array.
 * Rejects when the body (or any NDJSON line) is not JSON.
 */
export async function readBatch(request: Request): Promise<unknown> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const text =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(bytes);
  // JSON.stringify never writes a raw line break, so one outside an array means NDJSON; a one-event
  // NDJSON batch is a single object, told apart from a format() object by its closing \n.
  if (text.trimStart().startsWith('[') || !text.includes('\n')) return JSON.parse(text);
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}
