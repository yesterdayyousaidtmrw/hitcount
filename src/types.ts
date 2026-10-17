import type { BuiltInEvents } from './events';

/** Any JSON-serialisable value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Props = Record<string, Json | undefined>;

/** Where visitor/session ids live. Only 'local' and 'cookie' recognise returning visitors. */
export type Persist = 'memory' | 'session' | 'local' | 'cookie';
export type Consent = 'granted' | 'pending' | 'denied';
export type TrafficKind = 'unknown' | 'human' | 'automated' | 'ai-agent' | 'crawler';

export interface PageContext {
  url: string;
  path: string;
  title: string;
  /** External referrer, or the previous page after an SPA navigation. */
  referrer?: string;
  /**
   * Shared by every event fired during one page view. SPA route changes start a new one.
   * @format uuid
   */
  viewId: string;
}

export interface DeviceContext {
  language: string;
  timezone: string;
  screen: string;
  viewport: string;
  touch: boolean;
  userAgent: string;
  /** browser … colorScheme are added by the device plugin. */
  browser?: string;
  /** Major version only. */
  browserVersion?: string;
  os?: string;
  deviceType?: DeviceType;
  /** Network Information API effectiveType (Chromium only), e.g. "4g". */
  connection?: string;
  colorScheme?: ColorScheme;
}

export type DeviceType = 'mobile' | 'tablet' | 'desktop';
export type ColorScheme = 'light' | 'dark';
export type Channel = 'direct' | 'internal' | 'search' | 'social' | 'ai' | 'email' | 'paid' | 'referral';

/** Added to page views by the channels plugin. */
export interface Source {
  channel: Channel;
  /** utm_source if set, else the referrer's host. Empty for direct visits. */
  name: string;
}

/** Added to every event by the channels plugin: where its session started. */
export interface Attribution {
  channel: Channel;
  /** As in Source: utm_source if set, else the referrer's host. Empty for direct visits. */
  name: string;
  /** Path of the session's first page. */
  landing: string;
  utm?: Utm;
}

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface Traffic {
  kind: TrafficKind;
  signals: string[];
}

/**
 * What weakened a fingerprint. canvas-noise: two identical canvas drawings read back differently, so
 * the canvas is left out of the id. canvas-unavailable, webgl-unavailable: the API is missing or
 * blocked. brave: Brave, which adds per-site, per-session noise to canvas and other readings.
 * resist-fingerprinting: Firefox's resistFingerprinting (also Tor and Mullvad Browser), which spoofs
 * the timezone and screen.
 */
export type FingerprintReason = 'canvas-noise' | 'canvas-unavailable' | 'webgl-unavailable' | 'brave' | 'resist-fingerprinting';

/** Added to every event by the fingerprint plugin: a hash of what the browser reveals about the device. */
export interface Fingerprint {
  /**
   * 128-bit hash of the canvas rendering, WebGL renderer, installed fonts, screen, hardware, timezone,
   * languages and platform, as 32 hex characters. The same browser on the same device gives the same
   * id on every page load, in every tab and after its storage is cleared.
   * @pattern ^[0-9a-f]{32}$
   */
  id: string;
  /**
   * True when the browser adds noise or spoofs values to resist fingerprinting (reason canvas-noise,
   * brave or resist-fingerprinting): the id may change between visits, so do not use it to link them.
   */
  scrambled: boolean;
  /** Everything that weakened the id. canvas-unavailable and webgl-unavailable leave it stable, only less unique. */
  reasons: FingerprintReason[];
}

/** One event as sent by the http and callback sinks. Built-in event names carry the props in src/events.ts. */
export interface HitcountEvent {
  schema: 1;
  /**
   * Unique per event: dedupe on it, since a retried batch can arrive more than once.
   * @format uuid
   */
  id: string;
  /** @minLength 1 */
  name: string;
  /**
   * ISO 8601, from the visitor's clock.
   * @format date-time
   */
  time: string;
  site?: string;
  /**
   * Returning-visitor id. Present when persist is 'local' (the default) or 'cookie' (a uuid), or when
   * the site passed its own visitorId (any string).
   */
  visitor?: string;
  /** @format uuid */
  session: string;
  /** Set by identify(). */
  user?: string;
  page: PageContext;
  device: DeviceContext;
  utm?: Utm;
  source?: Source;
  /** Where this session started; set by the channels plugin. */
  attribution?: Attribution;
  traffic?: Traffic;
  /** Device fingerprint; set by the fingerprint plugin. */
  fingerprint?: Fingerprint;
  props: Props;
}

export interface SendMeta {
  /** True when the page is being hidden or closed: the request must survive unload. */
  unloading: boolean;
}

export interface Sink {
  /** Also names the sink's saved outbox (_hitcount_x_outbox.<name>): keep it the same from page to page. */
  name: string;
  /**
   * Receives a batch. Treat the events as read-only: every sink gets the same objects.
   * Throw or reject and the batch is kept and retried with backoff (see maxRetries), unless the error
   * has `retryable: false`: then it is dropped at once and reported to onError. The http sink sets
   * `retryable` from the response: network errors, 408, 429 and 5xx are retried, other 4xx are not.
   */
  send(events: HitcountEvent[], meta: SendMeta): void | Promise<unknown>;
}

export interface Hooks {
  /** An event passed every filter and was queued. */
  event: HitcountEvent;
  /** The current page view is ending because a new one is starting (SPA navigation). */
  leave: undefined;
  /** The page was hidden. `final` is true on pagehide, when the page is being unloaded. */
  hide: { final: boolean };
}

export interface Plugin {
  name: string;
  /** Runs once when the plugin is added. Return a function that undoes it. */
  setup?(hitcount: Hitcount): void | (() => void);
  /**
   * Edit an event before it is queued, or return null to drop it. It can run before this plugin's
   * setup (pageviews tracks from its own setup), so use the hitcount passed here, not one saved in setup.
   */
  enrich?(event: HitcountEvent, hitcount: Hitcount): HitcountEvent | null | void;
}

export interface HitcountOptions {
  site?: string;
  sinks?: Sink[];
  plugins?: Plugin[];
  /**
   * Default 'local': the visitor id stays in localStorage, so returning visitors are recognised.
   * 'session' keeps ids for the tab only, 'memory' for the page only; neither stores a visitor id.
   */
  persist?: Persist;
  cookieDomain?: string;
  /**
   * Your own visitor id, e.g. from a first-party cookie your server sets: Safari caps cookies and
   * storage written by scripts at 7 days, server-set cookies last. Every event carries it,
   * whatever persist is, and hitcount stores nothing for it; reset() keeps it.
   */
  visitorId?: string;
  /** Inactivity before a new session starts. Default 30. */
  sessionTimeoutMinutes?: number;
  /** Default 'granted'. 'pending' holds events in memory until consent() is called. */
  consent?: Consent;
  /** Turn tracking off for visitors sending Global Privacy Control or Do Not Track. Default false. */
  respectPrivacySignals?: boolean;
  /** Events per request. Default 10. */
  batchSize?: number;
  /** Max wait before a partial batch is sent. Default 5000. */
  flushIntervalMs?: number;
  /**
   * Retries for a batch a sink failed to take, 2s, 10s, 30s, then 2 minutes apart, before it is dropped
   * and reported to onError. Default 5; 0 drops at once. Waiting batches (up to 100 events per sink)
   * are kept with the ids when the page is hidden, so the next page retries them (not with persist
   * 'cookie': cookies are too small and go out with every request).
   */
  maxRetries?: number;
  /** Last stop before the queue: return a changed event, or null/false to drop it. */
  beforeSend?(event: HitcountEvent): HitcountEvent | null | false | void;
  /**
   * Sink, plugin and hook failures: a sink's once its batch is dropped (retries used up, or not
   * retryable), and 'outbox' when the waiting batches cannot be saved. Default: console.warn once per source.
   */
  onError?(error: unknown, source: string): void;
  /** Log every event to the console. */
  debug?: boolean;
}

/** Key/value strings, as kept by hitcount.store. */
export interface Store {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface Hitcount {
  /** Built-in event names must carry their documented props (src/events.ts); any other name takes Props. */
  track<K extends string>(name: K, props?: K extends keyof BuiltInEvents ? BuiltInEvents[K] : Props): void;
  page(props?: Props): void;
  identify(userId: string, traits?: Props): void;
  /** Forget the user, visitor and session (call on logout). */
  reset(): void;
  /** Props added to every later event. Set a key to undefined to remove it. */
  set(props: Props): void;
  consent(state: Consent): void;
  use(...plugins: Plugin[]): void;
  on<K extends keyof Hooks>(hook: K, fn: (arg: Hooks[K]) => void): () => void;
  flush(): void;
  ids(): { visitor?: string; session: string; user?: string };
  /**
   * Storage for plugins, kept with the ids: in memory until consent is granted (values written before
   * then are not carried over), then in the persist mode as _hitcount_x_<key>. reset() and
   * consent('denied') remove every key used on this page.
   */
  store: Store;
  /** False when a privacy signal, denied consent or destroy() turned tracking off. */
  isEnabled(): boolean;
  destroy(): void;
}
