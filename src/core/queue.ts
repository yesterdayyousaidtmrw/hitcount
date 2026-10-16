import type { AnalyEvent, Sink } from '../types';

export interface QueueOptions {
  sinks: Sink[];
  batchSize: number;
  flushIntervalMs: number;
  onError(error: unknown, source: string): void;
}

export function createQueue({ sinks, batchSize, flushIntervalMs, onError }: QueueOptions) {
  let pending: AnalyEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(unloading = false): void {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    for (const sink of sinks) {
      const report = (error: unknown) => onError(error, `sink:${sink.name}`);
      try {
        const sent = sink.send(batch, { unloading });
        if (sent) sent.catch(report);
      } catch (error) {
        report(error);
      }
    }
  }

  function push(event: AnalyEvent): void {
    pending.push(event);
    if (pending.length >= batchSize) flush();
    else timer ??= setTimeout(flush, flushIntervalMs);
  }

  return { push, flush };
}
