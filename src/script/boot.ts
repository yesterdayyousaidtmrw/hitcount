// Shared start-up for the script-tag builds: <script src="analy.min.js" data-site="…" data-endpoint="…">
import { createAnaly } from '../core/tracker';
import { http } from '../sinks/http';
import type { Analy, Plugin } from '../types';
import { type PluginOptions, readConfig } from './config';

type Method = keyof Analy;
/** Pre-load stub: window.analy=window.analy||function(){(analy.q=analy.q||[]).push(arguments)} */
type Stub = ((...args: unknown[]) => unknown) & { q?: ArrayLike<unknown>[] };
type PluginFactory = (options?: object) => Plugin;

declare global {
  interface Window {
    analy?: Stub;
  }
}

const DEFAULT_PLUGINS = 'pageviews,engagement,clicks,forms,traffic,device,channels,fingerprint';

/** Reads the config (see ./config), replays queued calls, starts plugins, exposes window.analy. */
export function boot(registry: Record<string, PluginFactory>): void {
  const { endpoint, format, compress, headers, plugins, ...options } = readConfig(
    (document.currentScript as HTMLScriptElement | null)?.dataset ?? {},
    Object.keys(registry),
    DEFAULT_PLUGINS,
  );
  const missing = [...plugins.keys()].filter((name) => !registry[name]);
  if (missing.length) {
    console.warn(`[analy] plugins not in this build: ${missing.join(', ')} (analy.full.min.js has them all)`);
  }
  const debug = options.debug || /[?&]analy_debug(=|&|$)/.test(location.search);
  if (!endpoint && !debug) console.warn('[analy] no endpoint set, so events are not sent anywhere');

  const analy = createAnaly({
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
        console.warn(`[analy] plugins.${name} options rejected, so it runs with its defaults:`, error);
      }
    }
    return registry[name]();
  };

  const call = (method: unknown, args: unknown[]): unknown => {
    const fn = analy[method as Method];
    if (typeof fn !== 'function') {
      console.warn(`[analy] unknown method: ${String(method)}`);
      return undefined;
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
  };

  // Calls queued before load run before plugins start, so set()/consent() apply to the first page view.
  for (const queued of Array.from(window.analy?.q ?? [])) {
    const [method, ...args] = Array.from(queued);
    call(method, args);
  }
  // Registry order, not config order, so enrichers like redact always run last.
  analy.use(...Object.keys(registry).filter((name) => plugins.has(name)).map((name) => start(name, plugins.get(name)!)));

  // Callable both ways: analy('track', 'signup') and analy.track('signup').
  window.analy = Object.assign((method: unknown, ...args: unknown[]) => call(method, args), analy);
}
