import type { HitcountEvent, Sink, Store } from '../types';

// Wait before each retry of a failed batch; retries past the last step keep its delay.
const BACKOFF_MS = [2_000, 10_000, 30_000, 120_000];
// Per sink, so a long outage cannot grow memory or storage without bound. The oldest go first.
const OUTBOX_LIMIT = 100;

export interface QueueOptions {
  sinks: Sink[];
  batchSize: number;
  flushIntervalMs: number;
  /** Retries per failed batch before it is dropped and reported. */
  maxRetries: number;
  /** Keeps each sink's outbox across page loads. Without one, failed batches only live in memory. */
  store?: Store;
  onError(error: unknown, source: string): void;
}

/** A batch one sink failed to take, waiting for its next try. */
interface Retry {
  events: HitcountEvent[];
  failures: number;
  timer?: ReturnType<typeof setTimeout>;
}

// Sinks opt out per error: anything else thrown or rejected (network down, a bug) is worth another try.
const retryable = (error: unknown) => (error as { retryable?: unknown } | null)?.retryable !== false;

export function createQueue({ sinks, batchSize, flushIntervalMs, maxRetries, store, onError }: QueueOptions) {
  let pending: HitcountEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outboxes: Retry[][] = sinks.map(() => []);
  // Store key per sink; a second sink with the same name gets its position so the two never share one.
  const keys = sinks.map(({ name }, index) =>
    sinks.findIndex((sink) => sink.name === name) === index ? `outbox.${name}` : `outbox.${name}.${index}`,
  );
  // Bumped by clear(): a send that fails after it belongs to a forgotten outbox and must not come back.
  let epoch = 0;

  function send(index: number, events: HitcountEvent[], unloading: boolean, retry?: Retry): void {
    const sentIn = epoch;
    const failed = (error: unknown) => {
      // Forgotten meanwhile (clear, or pushed out by newer events): nothing left to retry.
      if (sentIn !== epoch || (retry && !outboxes[index].includes(retry))) return;
      fail(index, events, error, retry);
    };
    const delivered = () => retry && remove(index, retry);
    try {
      const sent = sinks[index].send(events, { unloading });
      if (sent) sent.then(delivered, failed);
      else delivered();
    } catch (error) {
      failed(error);
    }
  }

  function fail(index: number, events: HitcountEvent[], error: unknown, retry?: Retry): void {
    if (retryable(error)) {
      const waiting = retry ?? keep(index, { events, failures: 0 });
      // Every event in it is already waiting in this sink's outbox.
      if (!waiting) return;
      if (++waiting.failures <= maxRetries) {
        waiting.timer = setTimeout(
          () => send(index, waiting.events, false, waiting),
          BACKOFF_MS[Math.min(waiting.failures, BACKOFF_MS.length) - 1],
        );
        return;
      }
      remove(index, waiting);
    } else if (retry) remove(index, retry);
    onError(error, `sink:${sinks[index].name}`);
  }

  // Adds a batch minus the events already waiting (a saved outbox read back twice), then trims to the limit.
  function keep(index: number, retry: Retry): Retry | undefined {
    const outbox = outboxes[index];
    const waiting = new Set(outbox.flatMap(({ events }) => events.map((event) => event.id)));
    retry.events = retry.events.filter((event) => !waiting.has(event.id));
    if (!retry.events.length) return undefined;
    outbox.push(retry);
    let excess = waiting.size + retry.events.length - OUTBOX_LIMIT;
    if (excess > 0) onError(new Error(`outbox full: dropped the ${excess} oldest events`), `sink:${sinks[index].name}`);
    while (excess > 0) {
      const oldest = outbox[0];
      const dropped = Math.min(excess, oldest.events.length);
      // A new array, not splice: a sink may still hold the old one from a send in flight.
      oldest.events = oldest.events.slice(dropped);
      excess -= dropped;
      if (!oldest.events.length) remove(index, oldest);
    }
    return retry;
  }

  function remove(index: number, retry: Retry): void {
    clearTimeout(retry.timer);
    const outbox = outboxes[index];
    const at = outbox.indexOf(retry);
    if (at >= 0) outbox.splice(at, 1);
  }

  function flush(unloading = false): void {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    sinks.forEach((_, index) => send(index, batch, unloading));
  }

  function push(event: HitcountEvent): void {
    pending.push(event);
    if (pending.length >= batchSize) flush();
    else timer ??= setTimeout(flush, flushIntervalMs);
  }

  /** Writes each sink's outbox to the store (the page is being hidden and may not come back). */
  function save(): void {
    if (!store) return;
    outboxes.forEach((outbox, index) => {
      try {
        if (outbox.length) store.set(keys[index], JSON.stringify(outbox.map(({ events, failures }) => ({ events, failures }))));
        else store.remove(keys[index]);
      } catch (error) {
        // Storage full or blocked: the batches stay in memory and are still retried on this page.
        onError(error, 'outbox');
      }
    });
  }

  /** Takes over the outboxes an earlier page saved and tries them now; a later save writes them back. */
  function restore(): void {
    if (!store) return;
    keys.forEach((key, index) => {
      try {
        const saved = store.get(key);
        if (!saved) return;
        store.remove(key);
        for (const { events, failures } of JSON.parse(saved) as Retry[]) {
          const retry = keep(index, { events, failures });
          if (retry) send(index, retry.events, false, retry);
        }
      } catch (error) {
        onError(error, 'outbox');
      }
    });
  }

  /** Drops every waiting batch and stops its retries. Stored copies go with the ids (identity.reset/wipe). */
  function clear(): void {
    epoch++;
    for (const outbox of outboxes) for (const retry of outbox.splice(0)) clearTimeout(retry.timer);
  }

  return { push, flush, save, restore, clear };
}
