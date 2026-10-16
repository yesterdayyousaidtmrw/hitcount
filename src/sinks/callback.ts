import type { Sink } from '../types';

/** Hands each batch to your own function: push to a dataLayer, a worker, an SDK, anything. */
export function callback(send: Sink['send'], name = 'callback'): Sink {
  return { name, send };
}
