import type { HitcountEvent, Plugin } from '../types';

const SECRET_PARAMS = [
  'token', 'access_token', 'id_token', 'refresh_token', 'auth', 'key', 'api_key', 'apikey', 'secret',
  'password', 'pass', 'pwd', 'code', 'state', 'session', 'sid', 'email', 'signature', 'sig', 'otp',
];
const EMAIL = /[^\s/?#&=:]+(?:@|%40)[^\s/?#&=]+\.[a-z]{2,}/gi;
// Matches key=value pairs in both the query and the hash (#access_token=… from OAuth implicit flows).
const PARAM = /([?#&])([^=&#?]+)=([^&#]*)/g;
// Props whose whole purpose is personal: what a visitor typed, who they contact, their IP.
const PERSONAL_PROPS = ['values', 'address', 'ip'];
// What a visitor typed into one field, under a key that is innocent elsewhere: value is often an
// order total on a custom event, and Chrome's validation message quotes the typed text.
const TYPED_PROP = new Map([
  ['form_progress', 'value'],
  ['form_error', 'message'],
]);

export function redactText(text: string): string {
  return text.replace(EMAIL, '[email]');
}

/** Returns a function that blanks secret-looking params to "redacted" and emails to "[email]". */
export function createRedactor(extraParams: string[] = []): (text: string) => string {
  const secret = new Set([...SECRET_PARAMS, ...extraParams].map((p) => p.toLowerCase()));
  return (text) =>
    redactText(
      text.replace(PARAM, (match, separator: string, key: string) =>
        secret.has(key.toLowerCase()) ? `${separator}${key}=redacted` : match,
      ),
    );
}

function scrubAll<T>(value: T, scrub: (text: string) => string): T {
  if (typeof value === 'string') return scrub(value) as T;
  if (Array.isArray(value)) return value.map((item) => scrubAll(item, scrub)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubAll(v, scrub)])) as T;
  }
  return value;
}

export interface RedactOptions {
  /** Extra query/hash params to blank, on top of the built-in secret list. */
  params?: string[];
}

/**
 * Opt-in. Blanks secret-looking URL params and emails in the page, utm, attribution and props of every
 * event, and drops form values, contact addresses, IPs and the device fingerprint. Add it last so it
 * sees what other plugins added.
 */
export function redact({ params }: RedactOptions = {}): Plugin {
  const scrub = createRedactor(params);
  return {
    name: 'redact',
    enrich(event) {
      const props = { ...event.props };
      for (const key of PERSONAL_PROPS) delete props[key];
      const typed = TYPED_PROP.get(event.name);
      if (typed) delete props[typed];
      const redacted: HitcountEvent = {
        ...event,
        page: scrubAll(event.page, scrub),
        utm: scrubAll(event.utm, scrub),
        attribution: scrubAll(event.attribution, scrub),
        props: scrubAll(props, scrub),
      };
      // A device fingerprint singles a person out as surely as their IP.
      delete redacted.fingerprint;
      return redacted;
    },
  };
}
