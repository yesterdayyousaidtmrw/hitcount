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

/** section_view: a data-analy-view section seen for the first time in a page view. */
export type SectionViewProps = {
  /**
   * The data-analy-view value, e.g. pricing.
   * @minLength 1
   */
  section: string;
  /**
   * Ms from the start of the page view until the section counted as seen, its visible time included.
   * @asType integer
   * @minimum 0
   */
  timeToViewMs: number;
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

/** How much of a form holds a value. */
type FormFill = {
  /**
   * Counted fields that hold a value now.
   * @asType integer
   * @minimum 0
   */
  filled: number;
  /**
   * Fields the form counts: named and enabled, not hidden inputs or buttons; a radio group or
   * checkboxes sharing a name count once.
   * @asType integer
   * @minimum 0
   */
  total: number;
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
  /**
   * filled / total as a whole percentage. Null when the form has no named fields to count.
   * @asType integer
   * @nullable
   * @minimum 0
   * @maximum 100
   */
  completion: number | null;
  /**
   * Ms from the visitor's first focus or input in the form until now.
   * @asType integer
   * @minimum 0
   */
  msInForm: number;
};

/**
 * form_snapshot: a started, unsubmitted form's progress when the tab is hidden, sent again only if
 * it changed. Phones often never fire a real unload, so this can be the last word on a form.
 */
export type FormSnapshotProps = FormAbandonProps & FormFill;

/** form_progress: the visitor finished a field: changed it, or left it changed. */
export type FormProgressProps = FormFill & {
  /** data-analy, id or name of the form. */
  form: string;
  /** The field's name, else its id, else its tag. */
  field: string;
  /**
   * 1-based place of the field among the counted fields. Null for a field the form does not
   * count, such as one without a name.
   * @asType integer
   * @nullable
   * @minimum 1
   */
  position: number | null;
  /**
   * Ms from focusing the field to finishing it; 0 when it changed without being focused.
   * @asType integer
   * @minimum 0
   */
  msOnField: number;
  /**
   * What the field holds now: a file input's file names, a checkbox or radio's value while
   * checked, else ''. Removed by the redact plugin.
   */
  value?: string;
};

/** form_error: the browser refused a field's value (its invalid event), once per field per attempt. */
export type FormErrorProps = {
  /** data-analy, id or name of the form. */
  form: string;
  /** The field's name, else its id, else its tag. */
  field: string;
  /** The first failing ValidityState check. */
  reason:
    | 'valueMissing'
    | 'typeMismatch'
    | 'patternMismatch'
    | 'tooShort'
    | 'tooLong'
    | 'rangeUnderflow'
    | 'rangeOverflow'
    | 'stepMismatch'
    | 'badInput'
    | 'customError';
  /**
   * The browser's validationMessage, in the visitor's language. Chrome quotes what was typed, so
   * the redact plugin removes it.
   */
  message?: string;
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

/** dead_click: a click on something that looks actionable, after which nothing happened. */
export type DeadClickProps = {
  /** The actionable element clicked, e.g. button#buy.btn. */
  element: string;
  /** It was disabled or aria-disabled="true": the visitor tried to use it anyway. */
  disabled: boolean;
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

/** media: what happened to a <video> or <audio> element, or to an embedded YouTube or Vimeo player. */
export type MediaProps = {
  /** stop: the page was left while it was still playing. */
  action: 'play' | 'pause' | 'progress' | 'complete' | 'stop' | 'error';
  kind: 'video' | 'audio';
  /** Embedded players only (the embeds plugin): whose iframe player it is. Absent for <video> and <audio>. */
  provider?: 'youtube' | 'vimeo';
  /** data-analy, id, or the file name of the source (for an embed, the provider's video id). */
  media: string;
  /** The media URL; for an embed, the iframe's src. */
  src: string;
  /** Seconds into the media. */
  position: number;
  /** Seconds; null for live streams and before the browser (or the embedded player) has reported it. */
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

/** search: a page view whose URL carries a site-search query. */
export type SearchProps = {
  /** The search terms, trimmed. Emails in them are removed by the redact plugin. */
  query: string;
  /** The URL param the query came in, e.g. q. */
  param: string;
  /**
   * The number in the page's data-analy-results attribute; absent when there is none.
   * @asType integer
   * @minimum 0
   */
  results?: number;
};

/** Event name → props for every event the built-in plugins send. */
export type BuiltInEvents = {
  engagement: EngagementProps;
  section_view: SectionViewProps;
  outbound: LinkProps;
  download: DownloadProps;
  contact: ContactProps;
  form_abandon: FormAbandonProps;
  form_snapshot: FormSnapshotProps;
  form_progress: FormProgressProps;
  form_error: FormErrorProps;
  rage_click: RageClickProps;
  dead_click: DeadClickProps;
  heatmap_click: HeatmapClickProps;
  error: ErrorProps;
  vitals: VitalsProps;
  turnstile: TurnstileProps;
  cloudflare: CloudflareProps;
  media: MediaProps;
  search: SearchProps;
};
