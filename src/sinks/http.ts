import type { AnalyEvent, Sink } from '../types';

export interface HttpSinkOptions {
  /** Extra request headers. Any header forces fetch (sendBeacon cannot send headers) and a CORS preflight. */
  headers?: Record<string, string>;
  /** Shape the request body for your API. Default: the event array as-is. */
  format?(events: AnalyEvent[]): unknown;
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

/** POSTs each batch as JSON to any URL. */
export function http(url: string, { headers, format, compress }: HttpSinkOptions = {}): Sink {
  const post = (body: string | ArrayBuffer, size: number) =>
    fetch(url, {
      method: 'POST',
      body,
      headers: headers ? { 'content-type': 'application/json', ...headers } : { 'content-type': 'text/plain' },
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
      const body = JSON.stringify(format ? format(events) : events);
      // text/plain is CORS-safelisted: no preflight, and sendBeacon accepts it cross-origin.
      if (unloading && !headers && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
      // Compression is async: while unloading the page may be gone before it finishes, so send it plain.
      if (!compress || unloading || typeof CompressionStream !== 'function') return post(body, body.length);
      return gzip(body).then((zipped) => post(zipped, zipped.byteLength));
    },
  };
}
