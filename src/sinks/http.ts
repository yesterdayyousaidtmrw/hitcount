import type { HitcountEvent, Sink } from '../types';
import { toRow } from './row';

/** The request body presets: see HttpSinkOptions.format. */
export type HttpFormat = 'events' | 'rows' | 'ndjson';

export interface HttpSinkOptions {
  /** Extra request headers. Any header forces fetch (sendBeacon cannot send headers) and a CORS preflight. */
  headers?: Record<string, string>;
  /**
   * The request body. 'events' (default): the event array as JSON. 'rows': a JSON array of toRow()
   * rows, flat snake_case, column for column the table in schema/postgres.sql. 'ndjson': one event as
   * JSON per line, every line ending in \n. A function: your own shape, sent as JSON.
   */
  format?: HttpFormat | ((events: HitcountEvent[]) => unknown);
  /**
   * Gzip the body where the browser has CompressionStream. The content type does not change (text/plain
   * without headers: still no preflight); the collector spots gzip by its first two bytes (1f 8b), and
   * readBatch() from hitcount/server reads both. Batches sent while the page unloads go uncompressed.
   */
  compress?: boolean;
}

// Browsers cap keepalive request bodies at 64 KiB; above it the request may not survive unload.
const KEEPALIVE_LIMIT = 60_000;

// Timeout, rate limit or server trouble may pass; any other 4xx means this batch will never be taken.
const isRetryable = (status: number) => status === 408 || status === 429 || status >= 500;

const gzip = (text: string): Promise<ArrayBuffer> =>
  new Response(new Response(text).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();

const encode = (events: HitcountEvent[], format: HttpSinkOptions['format']): string =>
  format === 'ndjson'
    ? events.map((event) => `${JSON.stringify(event)}\n`).join('')
    : JSON.stringify(format === 'rows' ? events.map(toRow) : typeof format === 'function' ? format(events) : events);

/** POSTs each batch to any URL: JSON by default, or rows or NDJSON (format). */
export function http(url: string, { headers, format, compress }: HttpSinkOptions = {}): Sink {
  // Headers mean a preflight anyway, so the body can say what it is.
  const contentType = format === 'ndjson' ? 'application/x-ndjson' : 'application/json';
  const post = (body: string | ArrayBuffer, size: number) =>
    fetch(url, {
      method: 'POST',
      body,
      headers: headers ? { 'content-type': contentType, ...headers } : { 'content-type': 'text/plain' },
      keepalive: size < KEEPALIVE_LIMIT,
      credentials: 'omit',
    }).then(
      (res) => {
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} from ${url}`), { retryable: isRetryable(res.status) });
      },
      // fetch rejects with a TypeError when the network is down or CORS blocks the response.
      (error) => {
        throw Object.assign(error, { retryable: true });
      },
    );

  return {
    name: 'http',
    send(events, { unloading }) {
      const body = encode(events, format);
      // text/plain is CORS-safelisted: no preflight, and sendBeacon accepts it cross-origin.
      if (unloading && !headers && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
      // Compression is async: while unloading the page may be gone before it finishes, so send it plain.
      if (!compress || unloading || typeof CompressionStream !== 'function') return post(body, body.length);
      return gzip(body).then((zipped) => post(zipped, zipped.byteLength));
    },
  };
}
