import {
  channels, clicks, cloudflare, deadclicks, device, embeds, engagement, errors, forms, heatmap, media, pageviews,
  rageclicks, redact, search, sections, traffic, turnstile, vitals,
} from '../../src/index';
import type { Consent, Persist, Plugin } from '../../src/types';
import type { Rng } from './rng';

const FACTORIES: Record<string, () => Plugin> = {
  pageviews, engagement, clicks, forms, traffic, device, channels, rageclicks, heatmap, errors, vitals, media,
  embeds, turnstile, cloudflare, search, sections, deadclicks,
  // Last, as documented, so it sees what the others add.
  redact,
};
export const PLUGIN_NAMES = Object.keys(FACTORIES);
/** Every subset of the plugins: FUZZ_EXHAUSTIVE runs one session per subset. */
export const PLUGIN_SUBSETS = 2 ** PLUGIN_NAMES.length;

export interface FuzzConfig {
  persist: Persist;
  consent: Consent;
  privacySignal: 'none' | 'gpc' | 'dnt';
  respectPrivacySignals: boolean;
  storageBlocked: boolean;
  batchSize: number;
  plugins: string[];
  /** An extra sink besides the recording one, to prove one bad sink cannot hurt the others. */
  extraSink: 'none' | 'throws' | 'rejects';
  /** drop: beforeSend drops custom events whose name ends in 3. mutate: it adds a prop. */
  beforeSend: 'none' | 'drop' | 'mutate';
}

/** A random config; pass pluginMask to choose the plugin subset instead (bit i = PLUGIN_NAMES[i]). */
export function randomConfig(rng: Rng, pluginMask = rng.int(0, PLUGIN_SUBSETS - 1)): FuzzConfig {
  return {
    persist: rng.pick(['memory', 'session', 'local', 'cookie'] as const),
    consent: rng.pick(['granted', 'granted', 'pending', 'denied'] as const),
    privacySignal: rng.pick(['none', 'none', 'none', 'gpc', 'dnt'] as const),
    respectPrivacySignals: rng.chance(0.7),
    storageBlocked: rng.chance(0.15),
    batchSize: rng.pick([1, 2, 3, 10]),
    plugins: PLUGIN_NAMES.filter((_, i) => pluginMask & (1 << i)),
    extraSink: rng.pick(['none', 'none', 'throws', 'rejects'] as const),
    beforeSend: rng.pick(['none', 'none', 'drop', 'mutate'] as const),
  };
}

export const makePlugins = (names: string[]): Plugin[] => names.map((name) => FACTORIES[name]());
