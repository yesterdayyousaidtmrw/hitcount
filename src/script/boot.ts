// Shared start-up for the script-tag builds: <script src="analy.min.js" data-site="…" data-endpoint="…">
import { createAnaly } from '../core/tracker';
import { http } from '../sinks/http';
import type { Analy, Consent, Persist, Plugin } from '../types';

type Method = keyof Analy;
/** Pre-load stub: window.analy=window.analy||function(){(analy.q=analy.q||[]).push(arguments)} */
type Stub = ((...args: unknown[]) => unknown) & { q?: ArrayLike<unknown>[] };

declare global {
  interface Window {
    analy?: Stub;
  }
}

const DEFAULT_PLUGINS = 'pageviews,engagement,clicks,forms,traffic,device,channels,fingerprint';

/** Reads the script tag's data-* attributes, replays queued calls, starts plugins, exposes window.analy. */
export function boot(registry: Record<string, () => Plugin>): void {
  const config = (document.currentScript as HTMLScriptElement | null)?.dataset ?? {};
  const pluginList = config.plugins ?? DEFAULT_PLUGINS;
  const requested =
    pluginList === 'all' ? Object.keys(registry) : pluginList.split(',').map((s) => s.trim()).filter(Boolean);
  // Declaring funnels is asking for them, so data-funnels needs no data-plugins entry. On the lite
  // build this lands in the warning below, which points to the full build.
  if (config.funnels !== undefined && !requested.includes('funnels')) requested.push('funnels');
  const missing = requested.filter((name) => !registry[name]);
  if (missing.length) {
    console.warn(`[analy] plugins not in this build: ${missing.join(', ')} (analy.full.min.js has them all)`);
  }
  const debug = 'debug' in config || /[?&]analy_debug(=|&|$)/.test(location.search);
  if (!config.endpoint && !debug) console.warn('[analy] no data-endpoint set, so events are not sent anywhere');

  const analy = createAnaly({
    site: config.site ?? location.hostname,
    sinks: config.endpoint ? [http(config.endpoint, { compress: 'compress' in config })] : [],
    persist: config.persist as Persist | undefined,
    consent: config.consent as Consent | undefined,
    cookieDomain: config.cookieDomain,
    visitorId: config.visitorId,
    respectPrivacySignals: 'respectPrivacySignals' in config,
    debug,
  });

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
  // Registry order, not attribute order, so enrichers like redact always run last.
  analy.use(...Object.keys(registry).filter((name) => requested.includes(name)).map((name) => registry[name]()));

  // Callable both ways: analy('track', 'signup') and analy.track('signup').
  window.analy = Object.assign((method: unknown, ...args: unknown[]) => call(method, args), analy);
}
