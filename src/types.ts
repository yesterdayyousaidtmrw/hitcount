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

/** One event as sent by the http and callback sinks. Built-in event names carry the props in src/events.ts. */
export interface AnalyEvent {
  schema: 1;
  /**
   * Unique per event: dedupe on it if you retry inserts.
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
   * Returning-visitor id. Present when persist is 'local' or 'cookie' (a uuid), or when the site
   * passed its own visitorId (any string).
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
  traffic?: Traffic;
  props: Props;
}

export interface SendMeta {
  /** True when the page is being hidden or closed: the request must survive unload. */
  unloading: boolean;
}

export interface Sink {
  name: string;
  /** Receives a batch. Treat the events as read-only: every sink gets the same objects. */
  send(events: AnalyEvent[], meta: SendMeta): void | Promise<unknown>;
}

export interface Hooks {
  /** An event passed every filter and was queued. */
  event: AnalyEvent;
  /** The current page view is ending because a new one is starting (SPA navigation). */
  leave: undefined;
  /** The page was hidden. `final` is true on pagehide, when the page is being unloaded. */
  hide: { final: boolean };
}

export interface Plugin {
  name: string;
  /** Runs once when the plugin is added. Return a function that undoes it. */
  setup?(analy: Analy): void | (() => void);
  /** Edit an event before it is queued, or return null to drop it. */
  enrich?(event: AnalyEvent): AnalyEvent | null | void;
}

export interface AnalyOptions {
  site?: string;
  sinks?: Sink[];
  plugins?: Plugin[];
  /** Default 'session': cookieless, ids end with the tab. */
  persist?: Persist;
  cookieDomain?: string;
  /**
   * Your own visitor id, e.g. from a first-party cookie your server sets: Safari caps cookies and
   * storage written by scripts at 7 days, server-set cookies last. Every event carries it,
   * whatever persist is, and analy stores nothing for it; reset() keeps it.
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
  /** Last stop before the queue: return a changed event, or null/false to drop it. */
  beforeSend?(event: AnalyEvent): AnalyEvent | null | false | void;
  /** Sink, plugin and hook failures. Default: console.warn once per source. */
  onError?(error: unknown, source: string): void;
  /** Log every event to the console. */
  debug?: boolean;
}

export interface Analy {
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
  /** False when a privacy signal, denied consent or destroy() turned tracking off. */
  isEnabled(): boolean;
  destroy(): void;
}
