import type { Analy, AnalyEvent, AnalyOptions, Consent, PageContext, Plugin, Props } from '../types';
import { deviceContext, utmFrom } from './context';
import { createHooks } from './hooks';
import { createIdentity } from './identity';
import { hasPrivacySignal } from './privacy';
import { createQueue } from './queue';
import { uid } from './uid';

// Events tracked while consent is pending are held in memory, up to this many.
const MAX_HELD = 100;

type PageSnapshot = Pick<PageContext, 'url' | 'path' | 'title'>;

// JSON drops undefined values on the wire; dropping them here too means callback sinks and
// on('event') see exactly what the http sink sends.
function withoutUndefined(props: Props): Props {
  for (const key of Object.keys(props)) if (props[key] === undefined) delete props[key];
  return props;
}

function warnOncePerSource(): (error: unknown, source: string) => void {
  const warned = new Set<string>();
  return (error, source) => {
    if (warned.has(source)) return;
    warned.add(source);
    console.warn(`[analy] ${source} failed`, error);
  };
}

export function createAnaly(options: AnalyOptions = {}): Analy {
  const {
    site,
    persist = 'session',
    cookieDomain,
    sessionTimeoutMinutes = 30,
    respectPrivacySignals = false,
    batchSize = 10,
    flushIntervalMs = 5000,
    beforeSend,
    debug = false,
  } = options;
  const onError = options.onError ?? warnOncePerSource();
  const identity = createIdentity(persist, sessionTimeoutMinutes * 60_000, cookieDomain);
  const hooks = createHooks(onError);
  const queue = createQueue({ sinks: options.sinks ?? [], batchSize, flushIntervalMs, onError });
  const plugins: Plugin[] = [];
  // Plugins added while the page is still prerendering; they start when it is shown.
  const waiting: Plugin[] = [];
  const teardowns: Array<() => void> = [];

  let enabled = !(respectPrivacySignals && hasPrivacySignal());
  let prerendering = (document as Document & { prerendering?: boolean }).prerendering === true;
  let consentState: Consent = options.consent ?? 'granted';
  let held: AnalyEvent[] = [];
  let globals: Props = {};
  let viewId = uid();
  // Snapshot taken at the last page(); every event in that view reports the same url/title.
  let current: PageSnapshot | undefined;
  let referrer = document.referrer || undefined;

  const snapshot = (): PageSnapshot => ({ url: location.href, path: location.pathname, title: document.title });

  function build(name: string, props?: Props): AnalyEvent {
    return {
      schema: 1,
      id: uid(),
      name,
      time: new Date().toISOString(),
      site,
      visitor: undefined,
      session: '',
      user: undefined,
      page: { ...(current ?? snapshot()), referrer, viewId },
      device: deviceContext(),
      utm: utmFrom(location.search),
      props: withoutUndefined({ ...globals, ...props }),
    };
  }

  // Ids and plugin enrichment happen here, not in build(), so held events get post-consent ids.
  function finalize(event: AnalyEvent): void {
    try {
      event.visitor = identity.visitor();
      event.session = identity.session();
      event.user = identity.user();
      let out: AnalyEvent | null = event;
      for (const plugin of plugins) {
        if (!out || !plugin.enrich) continue;
        const result = plugin.enrich(out);
        if (result === null) out = null;
        else if (result) out = result;
      }
      if (out && beforeSend) {
        const result = beforeSend(out);
        out = result === null || result === false ? null : result || out;
      }
      if (!out) return;
      hooks.emit('event', out);
      queue.push(out);
    } catch (error) {
      onError(error, `event:${event.name}`);
    }
  }

  function capture(name: string, props?: Props): void {
    if (!enabled || consentState === 'denied') return;
    if (typeof name !== 'string' || !name) {
      onError(new TypeError('event name must be a non-empty string'), 'track');
      return;
    }
    const event = build(name, props);
    if (consentState === 'pending' || prerendering) {
      if (held.length < MAX_HELD) held.push(event);
      return;
    }
    finalize(event);
  }

  // Sends held events once nothing stands in the way: consent, prerendering, destroy, privacy signal.
  function release(): void {
    if (!enabled || prerendering || consentState !== 'granted') return;
    identity.enable();
    const events = held;
    held = [];
    events.forEach(finalize);
  }

  function setUp(added: Plugin[]): void {
    for (const plugin of added) {
      try {
        const teardown = plugin.setup?.(analy);
        if (teardown) teardowns.push(teardown);
      } catch (error) {
        onError(error, `plugin:${plugin.name}`);
      }
    }
  }

  function start(added: Plugin[]): void {
    // Registered before any plugin so the 'hide' hook runs ahead of plugins' own visibility listeners.
    document.addEventListener('visibilitychange', onVisibility);
    addEventListener('pagehide', onPageHide);
    // Registered before held events go out (so enrichers see them) and before any setup runs.
    plugins.push(...added);
    release();
    setUp(added);
  }

  function hide(final: boolean): void {
    hooks.emit('hide', { final });
    queue.flush(true);
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') hide(false);
  };
  const onPageHide = () => hide(true);
  const onActivate = () => {
    prerendering = false;
    start(waiting.splice(0));
  };

  const analy: Analy = {
    track: capture,
    page(props) {
      if (!enabled) return;
      if (current) {
        hooks.emit('leave', undefined);
        referrer = current.url;
      }
      viewId = uid();
      current = snapshot();
      capture('pageview', props);
    },
    identify(userId, traits) {
      if (!enabled) return;
      identity.setUser(userId);
      capture('identify', traits);
    },
    reset() {
      identity.reset();
      globals = {};
    },
    set(props) {
      globals = withoutUndefined({ ...globals, ...props });
    },
    consent(state) {
      consentState = state;
      if (state === 'denied') {
        held = [];
        identity.wipe();
      } else release();
    },
    use(...added) {
      if (!enabled) return;
      if (prerendering) {
        waiting.push(...added);
        return;
      }
      // Register all first: a setup that tracks right away (pageviews) must reach every enricher.
      plugins.push(...added);
      setUp(added);
    },
    on: hooks.on,
    flush: () => queue.flush(),
    ids: () => ({ visitor: identity.visitor(), session: identity.session(), user: identity.user() }),
    isEnabled: () => enabled && consentState !== 'denied',
    destroy() {
      if (!enabled) return;
      queue.flush();
      for (const teardown of teardowns.splice(0)) {
        try {
          teardown();
        } catch (error) {
          onError(error, 'destroy');
        }
      }
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('prerenderingchange', onActivate);
      removeEventListener('pagehide', onPageHide);
      hooks.clear();
      held = [];
      enabled = false;
    },
  };

  if (!enabled) {
    if (debug) console.info('[analy] off: the browser sent Global Privacy Control or Do Not Track');
    return analy;
  }
  if (debug) hooks.on('event', (event) => console.log(`[analy] ${event.name}`, event));
  if (prerendering) {
    // Speculation Rules prerender pages the visitor may never open: wait until it is actually shown.
    waiting.push(...(options.plugins ?? []));
    document.addEventListener('prerenderingchange', onActivate, { once: true });
  } else start(options.plugins ?? []);
  return analy;
}
