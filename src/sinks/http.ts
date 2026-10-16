import type { AnalyEvent, Sink } from '../types';

export interface HttpSinkOptions {
  /** Extra request headers. Any header forces fetch (sendBeacon cannot send headers) and a CORS preflight. */
  headers?: Record<string, string>;
  /** Shape the request body for your API. Default: the event array as-is. */
  format?(events: AnalyEvent[]): unknown;
}

// Browsers cap keepalive request bodies at 64 KiB; above it the request may not survive unload.
const KEEPALIVE_LIMIT = 60_000;

/** POSTs each batch as JSON to any URL. */
export function http(url: string, { headers, format }: HttpSinkOptions = {}): Sink {
  return {
    name: 'http',
    send(events, { unloading }) {
      const body = JSON.stringify(format ? format(events) : events);
      // text/plain is CORS-safelisted: no preflight, and sendBeacon accepts it cross-origin.
      if (unloading && !headers && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
      return fetch(url, {
        method: 'POST',
        body,
        headers: headers ? { 'content-type': 'application/json', ...headers } : { 'content-type': 'text/plain' },
        keepalive: body.length < KEEPALIVE_LIMIT,
        credentials: 'omit',
      }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      });
    },
  };
}
