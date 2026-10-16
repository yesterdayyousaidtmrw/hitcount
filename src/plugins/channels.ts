import type { AnalyEvent, Attribution, Channel, Plugin, Source, Store, Utm } from '../types';

// Checked in this order: gemini.google.com is AI and mail.google.com is email before google.* is search.
// A trailing dot means any TLD (google.co.uk). Plain strings gzip far smaller than one regex per host.
const HOSTS: Array<[Channel, string]> = [
  ['ai', 'chatgpt.com openai.com perplexity.ai claude.ai gemini.google.com copilot.microsoft.com chat.deepseek.com meta.ai grok.com you.com phind.com'],
  ['email', 'mail.google.com outlook.live.com outlook.office.com mail.yahoo.com mail.proton.me'],
  ['search', 'google. bing.com duckduckgo.com search.yahoo.com yandex. baidu.com ecosia.org search.brave.com startpage.com kagi.com'],
  ['social', 'facebook.com instagram.com t.co twitter.com x.com linkedin.com lnkd.in reddit.com youtube.com tiktok.com pinterest. threads.net bsky.app news.ycombinator.com discord.com mastodon.social'],
];

const isHost = (name: string, host: string) =>
  host.endsWith('.') ? name.startsWith(host) || name.includes(`.${host}`) : name === host || name.endsWith(`.${host}`);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // utm_source values are often bare names ("chatgpt.com", "newsletter"), not URLs.
    return url.toLowerCase().replace(/^www\./, '');
  }
};

/** Where a page view came from: direct, internal, search, social, ai, email, paid or referral. */
export function classifySource(referrer: string | undefined, utm: Utm | undefined, ownHost: string): Source {
  const medium = utm?.medium?.toLowerCase() ?? '';
  const name = utm?.source ? hostOf(utm.source) : referrer ? hostOf(referrer) : '';
  if (/^(cpc|ppc|paid)/.test(medium)) return { channel: 'paid', name };
  if (medium.includes('email')) return { channel: 'email', name };
  const known = HOSTS.find(([, hosts]) => hosts.split(' ').some((host) => isHost(name, host)));
  if (known) return { channel: known[0], name };
  if (!name) return { channel: 'direct', name };
  return { channel: name === ownHost.replace(/^www\./, '') ? 'internal' : 'referral', name };
}

const FIRST_TOUCH = 'attribution';

/** The first touch stored for this session, or undefined when the session has none yet. */
function storedTouch(store: Store, session: string): Attribution | undefined {
  try {
    const { session: touched, ...touch } = JSON.parse(store.get(FIRST_TOUCH) ?? '{}');
    return touched === session ? touch : undefined;
  } catch {
    // Unreadable (edited by hand, say): the session starts a new first touch rather than failing the event.
    return undefined;
  }
}

// The session's first event is normally its page view; after a timeout it can be any event, which then
// starts the new session's first touch from the page the visitor is on.
function startTouch(store: Store, event: AnalyEvent, { channel, name }: Source): Attribution {
  const touch: Attribution = { channel, name, landing: event.page.path };
  if (event.utm) touch.utm = event.utm;
  store.set(FIRST_TOUCH, JSON.stringify({ session: event.session, ...touch }));
  return touch;
}

/**
 * Tags each page view with source: { channel, name }, including visitors sent by AI assistants, and
 * every event with attribution: the source, landing page and utm its session started with.
 */
export function channels(): Plugin {
  return {
    name: 'channels',
    enrich(event, analy) {
      const source = classifySource(event.page.referrer, event.utm, location.hostname);
      if (event.name === 'pageview') event.source = source;
      event.attribution = storedTouch(analy.store, event.session) ?? startTouch(analy.store, event, source);
      return event;
    },
  };
}
