// Props of the built-in events. These types are the source of schema/event.v1.json and
// docs/openapi.json (scripts/schema.mjs), and track() checks plugins against them.

/** engagement: one report per page view each time it is hidden or left. */
export type EngagementProps = {
  /**
   * Active ms since the last engagement event for this viewId; sum per viewId.
   * @asType integer
   * @minimum 1
   */
  activeMs: number;
  /**
   * Deepest scroll so far, as a percentage of the page.
   * @asType integer
   * @minimum 0
   * @maximum 100
   */
  scrollDepth: number;
};

/** outbound: a click on a link to another host. */
export type LinkProps = {
  url: string;
};

/** download: a click on a file link (by extension or the download attribute). */
export type DownloadProps = {
  url: string;
  file: string;
};

/** contact: a click on a mailto: or tel: link. */
export type ContactProps = {
  channel: 'email' | 'phone';
  /** The email address or phone number. Removed by the redact plugin. */
  address?: string;
};

/** form_abandon: a form the visitor started but left without submitting. */
export type FormAbandonProps = {
  /** data-analy, id or name of the form. */
  form: string;
  /**
   * @asType integer
   * @minimum 1
   */
  fieldsTouched: number;
  lastField: string;
  /** Field values by name. Removed by the redact plugin. */
  values?: Record<string, string>;
};

/** rage_click: repeated clicks on one spot. */
export type RageClickProps = {
  element: string | null;
  /**
   * @asType integer
   * @minimum 2
   */
  clicks: number;
};

/** heatmap_click: every click, with page and in-element position. */
export type HeatmapClickProps = {
  element: string;
  /** @asType integer */
  x: number;
  /** @asType integer */
  y: number;
  /** @asType integer */
  pageWidth: number;
  /** @asType integer */
  pageHeight: number;
  /** Position inside the element, 0–1. Null for zero-size elements. */
  elementX: number | null;
  elementY: number | null;
};

/** error: an uncaught error or unhandled promise rejection. */
export type ErrorProps = {
  kind: 'error' | 'unhandledrejection';
  message: string;
  source?: string | null;
  line?: number | null;
  column?: number | null;
  stack: string | null;
};

/** vitals: Core Web Vitals; keep the last one per viewId. Missing metrics are omitted. */
export type VitalsProps = {
  /** @asType integer */
  lcp?: number;
  /** @asType integer */
  fcp?: number;
  /** @asType integer */
  inp?: number;
  /** @asType integer */
  ttfb?: number;
  /** Unitless, 4 decimal places. */
  cls?: number;
};

/** turnstile: what happened to a Cloudflare Turnstile widget. */
export type TurnstileProps = {
  /** clicked means the visitor had to click: an interactive challenge. solved means a token was issued. */
  status: 'shown' | 'clicked' | 'solved' | 'expired';
  /** The widget's container, e.g. div#signup-check. */
  widget: string;
  /**
   * solved only: ms since the widget appeared.
   * @asType integer
   */
  ms?: number;
};

/** cloudflare: Cloudflare's view of the visitor from /cdn-cgi/trace, once per session. */
export type CloudflareProps = {
  /** Data centre that served the visitor, e.g. LHR. */
  colo: string;
  /** ISO country code (trace field loc). */
  country?: string;
  /** Removed by the redact plugin. */
  ip?: string;
  http?: string;
  tls?: string;
  /** on when the visitor uses Cloudflare WARP. */
  warp?: string;
  /** The cf_clearance cookie was readable: a Cloudflare challenge was passed recently. */
  clearance?: true;
};

/** media: what happened to a <video> or <audio> element. */
export type MediaProps = {
  /** stop: the page was left while it was still playing. */
  action: 'play' | 'pause' | 'progress' | 'complete' | 'stop' | 'error';
  kind: 'video' | 'audio';
  /** data-analy, id, or the file name of the source. */
  media: string;
  src: string;
  /** Seconds into the media. */
  position: number;
  /** Seconds; null for live streams and before the browser has loaded the media's metadata. */
  duration: number | null;
  muted: boolean;
  /** Seconds actually played in this page view so far, seeking excluded. Keep the largest per media and viewId. */
  watchedSeconds: number;
  /**
   * progress: the milestone reached; complete: 100.
   * @asType integer
   */
  percent?: number;
  /** error only: the MediaError code, 1–4. */
  code?: number | null;
};

/** Event name → props for every event the built-in plugins send. */
export type BuiltInEvents = {
  engagement: EngagementProps;
  outbound: LinkProps;
  download: DownloadProps;
  contact: ContactProps;
  form_abandon: FormAbandonProps;
  rage_click: RageClickProps;
  heatmap_click: HeatmapClickProps;
  error: ErrorProps;
  vitals: VitalsProps;
  turnstile: TurnstileProps;
  cloudflare: CloudflareProps;
  media: MediaProps;
};
