import type { CloudflareProps } from '../events';
import type { Plugin } from '../types';
import { createStore, readCookies } from '../core/storage';

export interface CloudflareOptions {
  /** Default /cdn-cgi/trace, which Cloudflare serves on every proxied hostname. */
  path?: string;
}

// Trace keys Cloudflare documents, renamed for readability.
const FIELDS: Record<string, string> = { loc: 'country', colo: 'colo', ip: 'ip', http: 'http', tls: 'tls', warp: 'warp' };
const SENT_KEY = '_analy_cf';

/** Picks the documented fields out of /cdn-cgi/trace's key=value lines. */
export function parseTrace(text: string): Partial<CloudflareProps> {
  const fields: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (FIELDS[key]) fields[FIELDS[key]] = rest.join('=').trim();
  }
  return fields;
}

/**
 * One `cloudflare` event per session with Cloudflare's view of the visitor: country, colo (edge
 * data centre), ip, http, tls, warp. clearance: true when the cf_clearance cookie (set after passing
 * a Cloudflare challenge) is readable; absent does not mean no challenge was passed.
 * Does nothing on sites that are not behind Cloudflare.
 */
export function cloudflare({ path = '/cdn-cgi/trace' }: CloudflareOptions = {}): Plugin {
  return {
    name: 'cloudflare',
    setup(analy) {
      const store = createStore('session');
      const { session } = analy.ids();
      if (store.get(SENT_KEY) === session) return;

      fetch(path, { credentials: 'omit' })
        .then(async (res) => {
          // A non-2xx here means the site is not proxied by Cloudflare: nothing to report.
          if (!res.ok) return;
          const { colo, ...rest } = parseTrace(await res.text());
          if (!colo) return;
          const props: CloudflareProps = { colo, ...rest };
          if (/(?:^|; )cf_clearance=/.test(readCookies())) props.clearance = true;
          store.set(SENT_KEY, session);
          analy.track('cloudflare', props);
        })
        .catch((error) => console.warn(`[analy] cloudflare: ${path} failed`, error));
    },
  };
}
