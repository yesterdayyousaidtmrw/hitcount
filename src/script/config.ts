// Script-tag settings from three places, merged in this order with later winning key by key: the
// tag's data-* attributes, a <script type="application/json" id="hitcount-config"> block, then
// window.hitcountConfig, the only one that can hold functions (beforeSend, onError, format).
import type { HttpSinkOptions } from '../sinks/http';
import type { HitcountOptions } from '../types';

/** true: on with the plugin's defaults; an object: on, with these options passed to its factory. */
export type PluginOptions = true | Record<string, unknown>;

export interface ScriptConfig
  extends Pick<
      HitcountOptions,
      | 'site'
      | 'persist'
      | 'consent'
      | 'cookieDomain'
      | 'visitorId'
      | 'respectPrivacySignals'
      | 'sessionTimeoutMinutes'
      | 'batchSize'
      | 'flushIntervalMs'
      | 'maxRetries'
      | 'debug'
      | 'beforeSend'
      | 'onError'
    >,
    Pick<HttpSinkOptions, 'format' | 'compress' | 'headers'> {
  /** Where the http sink posts. Without it events are not sent anywhere. */
  endpoint?: string;
  /** "all", a comma list or array of names, or { name: true | false | options } on top of the defaults. */
  plugins?: string | string[] | Record<string, PluginOptions | false>;
}

declare global {
  interface Window {
    hitcountConfig?: unknown;
  }
}

/** What each key must be: typeof names or exact values, | between choices. Any other key is unknown. */
export const CONFIG_RULES: Record<keyof ScriptConfig, string> = {
  site: 'string',
  endpoint: 'string',
  format: 'events|rows|ndjson|function',
  compress: 'boolean',
  headers: 'object',
  persist: 'memory|session|local|cookie',
  consent: 'granted|pending|denied',
  cookieDomain: 'string',
  visitorId: 'string',
  respectPrivacySignals: 'boolean',
  sessionTimeoutMinutes: 'number',
  batchSize: 'number',
  flushIntervalMs: 'number',
  maxRetries: 'number',
  debug: 'boolean',
  beforeSend: 'function',
  onError: 'function',
  plugins: 'string|object',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// NaN passes typeof 'number'; it is what a data-* attribute that is not a number parses to.
const fits = (value: unknown, rule: string) =>
  value !== null && !Number.isNaN(value) && rule.split('|').some((type) => typeof value === type || value === type);

const warnIgnored = (where: string, key: string, rule: string) =>
  console.warn(`[hitcount] ${where} ${key} should be ${rule}, ignored`);

function fromAttributes(dataset: DOMStringMap): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(CONFIG_RULES)) {
    const value = dataset[key];
    // Attributes are strings: a boolean is on by being there (data-compress), a number is parsed.
    if (value !== undefined) config[key] = rule === 'boolean' ? true : rule === 'number' ? Number(value) : value;
  }
  return config;
}

function fromJsonBlock(): unknown {
  const text = document.getElementById('hitcount-config')?.textContent;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn(`[hitcount] #hitcount-config is not valid JSON, ignored: ${(error as Error).message}`);
    return undefined;
  }
}

// A Map, not an object: a plugin named __proto__ in page JSON must not become a prototype.
function pickPlugins(
  picked: Map<string, PluginOptions>,
  choice: NonNullable<ScriptConfig['plugins']>,
  all: string[],
  where: string,
): Map<string, PluginOptions> {
  if (typeof choice === 'string' || Array.isArray(choice)) {
    const names = choice === 'all' ? all : typeof choice === 'string' ? choice.split(',') : choice;
    return new Map(names.map((name) => String(name).trim()).filter(Boolean).map((name) => [name, true]));
  }
  // An object edits the choice so far: the build's defaults, or what an earlier source picked.
  const next = new Map(picked);
  for (const [name, options] of Object.entries(choice)) {
    if (options === false) next.delete(name);
    else if (options === true || isRecord(options)) next.set(name, options);
    else warnIgnored(where, `plugins.${name}`, 'true|false|object');
  }
  return next;
}

// data-funnels='{"signup":[…]}' turns funnels on with those funnels: declaring them is asking for them.
function withFunnels(picked: Map<string, PluginOptions>, json: string): Map<string, PluginOptions> {
  try {
    return new Map(picked).set('funnels', { funnels: JSON.parse(json) });
  } catch {
    console.warn('[hitcount] data-funnels is not valid JSON, so no funnels are tracked');
    return picked;
  }
}

/** The merged config, its plugins resolved against the build: name → options. */
export function readConfig(
  dataset: DOMStringMap,
  all: string[],
  defaults: string,
): Omit<ScriptConfig, 'plugins'> & { plugins: Map<string, PluginOptions> } {
  const config: Record<string, unknown> = {};
  let plugins = pickPlugins(new Map(), defaults, all, '');
  const unknown = new Set<string>();
  const sources: Array<[string, unknown]> = [
    ['data-* attributes', fromAttributes(dataset)],
    ['#hitcount-config', fromJsonBlock()],
    ['window.hitcountConfig', window.hitcountConfig],
  ];
  for (const [where, source] of sources) {
    if (source === undefined) continue;
    if (!isRecord(source)) {
      console.warn(`[hitcount] ${where} should be an object, ignored`);
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      // Read as a plain record so inherited names (toString, __proto__) count as unknown.
      const rule = (CONFIG_RULES as Record<string, unknown>)[key];
      // Undefined means not set, so `visitorId: readCookie('vid')` needs no guard.
      if (value === undefined) continue;
      if (typeof rule !== 'string') unknown.add(key);
      else if (!fits(value, rule)) warnIgnored(where, key, rule);
      else if (key === 'plugins') plugins = pickPlugins(plugins, value as NonNullable<ScriptConfig['plugins']>, all, where);
      else config[key] = value;
    }
    if (where === 'data-* attributes' && dataset.funnels !== undefined) plugins = withFunnels(plugins, dataset.funnels);
  }
  if (unknown.size) console.warn(`[hitcount] unknown config keys, ignored: ${[...unknown].join(', ')}`);
  return { ...(config as Omit<ScriptConfig, 'plugins'>), plugins };
}
