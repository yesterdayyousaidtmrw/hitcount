// Shared start-up for the script-tag builds: <script src="hitcount.min.js" data-site="…" data-endpoint="…">
import { createHitcount } from '../core/tracker';
import { http } from '../sinks/http';
import type { Hitcount, Plugin } from '../types';
import { type PluginOptions, readConfig } from './config';

type Method = keyof Hitcount;
/** Pre-load stub: window.hitcount=window.hitcount||function(){(hitcount.q=hitcount.q||[]).push(arguments)} */
type Stub = ((...args: unknown[]) => unknown) & { q?: ArrayLike<unknown>[] };
type PluginFactory = (options?: object) => Plugin;

declare global {
  interface Window {
    hitcount?: Stub;
  }
}

const DEFAULT_PLUGINS = 'pageviews,engagement,clicks,forms,traffic,device,channels,fingerprint';

/** Reads the config (see ./config), replays queued calls, starts plugins, exposes window.hitcount. */
export function boot(registry: Record<string, PluginFactory>): void {
  const { endpoint, format, compress, headers, plugins, ...options } = readConfig(
    (document.currentScript as HTMLScriptElement | null)?.dataset ?? {},
    Object.keys(registry),
    DEFAULT_PLUGINS,
  );
  const missing = [...plugins.keys()].filter((name) => !registry[name]);
  if (missing.length) {
    console.warn(`[hitcount] plugins not in this build: ${missing.join(', ')} (hitcount.full.min.js has them all)`);
  }
  const debug = options.debug || /[?&]hitcount_debug(=|&|$)/.test(location.search);
  if (!endpoint && !debug) console.warn('[hitcount] no endpoint set, so events are not sent anywhere');

  const hitcount = createHitcount({
    ...options,
    site: options.site ?? location.hostname,
    sinks: endpoint ? [http(endpoint, { format, compress, headers })] : [],
    debug,
  });

  // Options come from the page, and a factory may refuse them (redact({ params: 5 }) throws). The
  // plugin still runs, with its defaults: a privacy plugin the site asked for must not fall away.
  const start = (name: string, pluginOptions: PluginOptions): Plugin => {
    if (pluginOptions !== true) {
      try {
        return registry[name](pluginOptions);
      } catch (error) {
        console.warn(`[hitcount] plugins.${name} options rejected, so it runs with its defaults:`, error);
      }
    }
    return registry[name]();
  };

  const call = (method: unknown, args: unknown[]): unknown => {
    const fn = hitcount[method as Method];
    if (typeof fn !== 'function') {
      console.warn(`[hitcount] unknown method: ${String(method)}`);
      return undefined;
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
  };

  // Calls queued before load run before plugins start, so set()/consent() apply to the first page view.
  for (const queued of Array.from(window.hitcount?.q ?? [])) {
    const [method, ...args] = Array.from(queued);
    call(method, args);
  }
  // Registry order, not config order, so enrichers like redact always run last.
  hitcount.use(...Object.keys(registry).filter((name) => plugins.has(name)).map((name) => start(name, plugins.get(name)!)));

  // Callable both ways: hitcount('track', 'signup') and hitcount.track('signup').
  window.hitcount = Object.assign((method: unknown, ...args: unknown[]) => call(method, args), hitcount);
}
