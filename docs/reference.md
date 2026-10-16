# analy reference

Every option, event and plugin. For an introduction, start with the [README](../README.md).

- [Script tag](#script-tag)
- [JavaScript API](#javascript-api)
- [Options](#options)
- [Events](#events)
- [Plugins](#plugins)
- [Destinations (sinks)](#destinations-sinks)
- [Pages without JavaScript](#pages-without-javascript)
- [Traffic detection](#traffic-detection)
- [Cloudflare](#cloudflare)
- [Privacy and consent](#privacy-and-consent)
- [Writing plugins and sinks](#writing-plugins-and-sinks)

## Script tag

| Build | Plugins | Gzipped |
| --- | --- | --- |
| `dist/analy.min.js` | pageviews, engagement, clicks, forms, traffic, device, channels | 6.7 KB |
| `dist/analy.full.min.js` | all 15; choose with `data-plugins` | 9.5 KB |

| Attribute | Default | |
| --- | --- | --- |
| `data-site` | `location.hostname` | Site id stamped on every event |
| `data-endpoint` | none | URL that receives `POST` batches. Without it, events go nowhere |
| `data-plugins` | the build's defaults | Comma list, or `all` |
| `data-persist` | `session` | `memory`, `session`, `local` or `cookie` |
| `data-consent` | `granted` | `pending` holds events until `analy.consent('granted')` |
| `data-cookie-domain` | none | e.g. `.example.com` to share ids across subdomains |
| `data-respect-privacy-signals` | off | Stay off for visitors sending Global Privacy Control or Do Not Track |
| `data-debug` | off | Log every event to the console. `?analy_debug` in the URL does the same |

Calls made before the script loads are queued and replayed before the first page view:

```html
<script>window.analy=window.analy||function(){(analy.q=analy.q||[]).push(arguments)}</script>
<script>analy('set', { plan: 'pro' })</script>
```

After it loads, both `analy.track('signup')` and `analy('track', 'signup')` work.

## JavaScript API

| Method | |
| --- | --- |
| `track(name, props?)` | Send a custom event. Built-in event names must carry their documented props (TypeScript checks this) |
| `page(props?)` | Start a new page view (the `pageviews` plugin calls this for you) |
| `identify(userId, traits?)` | Attach a user id to this and later events |
| `reset()` | Forget user, visitor and session. Call on logout |
| `set(props)` | Props added to every later event; set a key to `undefined` to remove it |
| `consent('granted' \| 'pending' \| 'denied')` | Release held events, hold new ones, or stop and wipe stored ids |
| `use(...plugins)` | Add plugins after start-up |
| `on('event' \| 'leave' \| 'hide', fn)` | Listen to the tracker; returns an unsubscribe function |
| `flush()` | Send queued events now |
| `ids()` | `{ visitor, session, user }` |
| `isEnabled()` | `false` after a respected privacy signal, denied consent or `destroy()` |
| `destroy()` | Flush, remove every listener, stop. Nothing is sent afterwards |

## Options

| Option | Default | |
| --- | --- | --- |
| `site` | none | Site id |
| `sinks` | `[]` | Where events go |
| `plugins` | `[]` | What is tracked automatically |
| `persist` | `'session'` | Where ids live (below) |
| `cookieDomain` | none | For `persist: 'cookie'` |
| `sessionTimeoutMinutes` | `30` | Inactivity before a new session |
| `consent` | `'granted'` | Starting consent state |
| `respectPrivacySignals` | `false` | Stay off for visitors sending Global Privacy Control or Do Not Track |
| `batchSize` | `10` | Events per request |
| `flushIntervalMs` | `5000` | Longest wait before a partial batch is sent |
| `beforeSend(event)` | none | Edit an event, or return `null` to drop it |
| `onError(error, source)` | warn once per source | Sink, plugin and hook failures |
| `debug` | `false` | Log every event |

| `persist` | Stores | Returning visitors |
| --- | --- | --- |
| `memory` | nothing | no; each page load is a new session |
| `session` | sessionStorage, gone when the tab closes | no |
| `local` | localStorage | yes |
| `cookie` | first-party cookie, optional `cookieDomain` | yes, across subdomains |

Where the chosen storage is blocked, ids fall back to memory and tracking carries on.

## Events

```json
{
  "schema": 1,
  "id": "6f1c…", "name": "pageview", "time": "2026-10-16T12:00:00.000Z", "site": "my-site", "session": "b2e0…",
  "page": { "url": "https://example.com/pricing?utm_source=chatgpt.com", "path": "/pricing", "title": "Pricing", "referrer": "https://chatgpt.com/", "viewId": "91aa…" },
  "device": { "language": "en-GB", "timezone": "Europe/London", "screen": "1512x982", "viewport": "1512x861", "touch": false,
              "userAgent": "Mozilla/5.0 …", "browser": "Safari", "browserVersion": "18", "os": "macOS", "deviceType": "desktop", "colorScheme": "dark" },
  "utm": { "source": "chatgpt.com" },
  "source": { "channel": "ai", "name": "chatgpt.com" },
  "traffic": { "kind": "human", "signals": [] },
  "props": {}
}
```

`visitor` appears with `persist: 'local' | 'cookie'`, `user` after `identify()`. All events in one page view share `page.viewId`.

The machine-readable contract, generated from the source on every build:

- [`openapi.json`](openapi.json): the request a collector receives, with real examples captured in Chrome
- [`../schema/event.v1.json`](../schema/event.v1.json): one event
- [`../schema/row.v1.json`](../schema/row.v1.json) and [`../schema/postgres.sql`](../schema/postgres.sql): the flat row and its table

| Event | Plugin | Props |
| --- | --- | --- |
| `pageview` | pageviews | your own |
| `engagement` | engagement | `activeMs` (sum per `viewId`), `scrollDepth` 0–100 |
| `outbound`, `download` | clicks | `url`, `file` |
| `contact` | clicks | `channel` (`email`/`phone`), `address` |
| any `data-analy` name | clicks, forms | every `data-analy-*` attribute; forms add `values` |
| `form_abandon` | forms | `form`, `fieldsTouched`, `lastField`, `values` |
| `rage_click` | rageclicks | `element`, `clicks` |
| `heatmap_click` | heatmap | `element`, `x`, `y`, `pageWidth`, `pageHeight`, `elementX`, `elementY` |
| `error` | errors | `kind`, `message`, `source`, `line`, `column`, `stack` |
| `vitals` | vitals | `lcp`, `cls`, `inp`, `fcp`, `ttfb`; keep the last per `viewId` |
| `media` | media | `action` (`play`, `pause`, `progress`, `complete`, `stop`, `error`), `kind`, `media`, `src`, `position`, `duration`, `muted`, `watchedSeconds`, `percent`, `code` |
| `turnstile` | turnstile | `status` (`shown`, `clicked`, `solved`, `expired`), `widget`, `ms` |
| `cloudflare` | cloudflare | `colo`, `country`, `ip`, `http`, `tls`, `warp`, `clearance` |
| `identify` | `identify()` | the traits you passed |

## Plugins

| Plugin | What it does | Options |
| --- | --- | --- |
| `pageviews()` | First page view, SPA navigation, and pages restored from the back/forward cache | `hash` to count `#route` changes |
| `engagement()` | Active time (visible + recent input) and scroll depth, sent when a page is hidden or left | `idleMs` (30 000) |
| `clicks()` | `data-analy` elements, outbound links, downloads, mailto/tel | `outbound`, `downloads`, `contact` |
| `forms()` | `<form data-analy="name">` on submit; `form_abandon` for forms started and left. `data-analy-ignore` skips a form | |
| `traffic()` | Human / crawler / AI agent / automated tag ([how](#traffic-detection)) | `drop: ['crawler', …]` |
| `device()` | Browser, major version, OS, device type, connection, colour scheme | |
| `channels()` | Where a page view came from: direct, internal, search, social, ai, email, paid, referral | |
| `rageclicks()` | Repeated clicks on one spot (not triple-click text selection) | `clicks`, `withinMs`, `radiusPx` |
| `heatmap()` | Every click with page and in-element position | |
| `errors()` | Uncaught errors and unhandled rejections, deduplicated | `max` (10 per page load) |
| `vitals()` | Core Web Vitals from real visitors | |
| `media()` | `<video>`/`<audio>`: play, pause, 25/50/75% progress, complete, error, `stop` when the page is left mid-play, real watched time. Name a player with `data-analy`; muted looping autoplay and `data-analy-ignore` are skipped. YouTube/Vimeo iframes are not seen | `milestones` |
| `turnstile()` | Cloudflare Turnstile outcomes, implicit or explicit widgets | `fieldName` |
| `cloudflare()` | One event per session from `/cdn-cgi/trace`; silent off Cloudflare | `path` |
| `redact()` | Blanks secret URL params (`token`, `code`, `password`…) and emails, drops `values`, `address`, `ip`. Add it last | `params` |

## Destinations (sinks)

| Sink | |
| --- | --- |
| `http(url, { headers?, format? })` | POSTs each batch; `sendBeacon` while the page unloads |
| `supabase({ url, key, table? })` | Inserts flat rows through Supabase's REST API |
| `callback(fn)` | Hands each batch to your function |

Batches sent by `http()` are a JSON array with `content-type: text/plain`, which needs no CORS preflight and works with `sendBeacon`. Parse the body as text. With custom headers the body is `application/json` and the browser sends a preflight first.

For Supabase, run [`../schema/postgres.sql`](../schema/postgres.sql) first. Its policy lets the public key insert and nothing else. `toRow(event)` gives the same flat row for any SQL database.

Delivery is at most once: a failed batch is reported to `onError` and dropped. Every event has a unique `id`, so inserts can be made idempotent.

## Pages without JavaScript

```html
<img src="https://collect.example.com/p.gif?site=blog" referrerpolicy="unsafe-url" width="1" height="1" alt="">
<img src="https://collect.example.com/p.gif?site=blog&e=read" loading="lazy" referrerpolicy="unsafe-url" width="1" height="1" alt="">
<style>.cta:active { background-image: url(https://collect.example.com/p.gif?site=blog&e=cta_click) }</style>
```

```ts
import { eventFromPixel, PIXEL_GIF, PIXEL_HEADERS } from 'analy-js/server';

const event = await eventFromPixel(request, { salt: env.SALT, ip: request.headers.get('cf-connecting-ip') ?? '' });
return new Response(PIXEL_GIF, { headers: PIXEL_HEADERS });
```

`e` names the event (default `pageview`), `u` overrides the page URL (default: the `Referer` header, hence `referrerpolicy="unsafe-url"`), and every other query param becomes a prop. Sessions are a daily hash of salt, site, IP and user agent; nothing is stored on the device. There is no screen size, timezone or original referrer, and bot detection is user-agent only. Runs anywhere with the Fetch API: Cloudflare Workers, Deno, Bun, Node 18+.

## Traffic detection

| Signal | Means | Kind |
| --- | --- | --- |
| `ai-user-agent` | UA names an AI crawler or fetcher (GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot, …) | `ai-agent` |
| `crawler-user-agent` | UA names a search or preview bot | `crawler` |
| `webdriver`, `headless-user-agent`, `no-languages`, `automation-globals` | Automation tool fingerprints | `automated` |
| `click-without-mouse-movement` | A mouse click with no movement before it, as CDP-driven agents do | `automated` |
| `centered-clicks` | Three clicks in a row within 3% of their target's exact centre | `automated` |

20+ real mouse moves or a touch make a visitor `human`; before that they are `unknown`. Take the latest verdict per session. Crawlers that do not run JavaScript never load the script, and an agent that moves and aims like a person will pass.

## Cloudflare

- `turnstile()` reports each widget's `shown`, `clicked` (an interactive challenge), `solved` (with time to solve) and `expired`, by watching the hidden response field Turnstile fills in, so keep `response-field` on. `solved` means a token was issued; only siteverify on your server proves it valid. For error codes and timeouts, call `analy.track('turnstile', …)` from Turnstile's own `error-callback` / `timeout-callback`.
- `cloudflare()` reads `/cdn-cgi/trace` once per session. `clearance: true` means the `cf_clearance` cookie was readable, so a Cloudflare challenge was passed recently.
- Challenge pages ("Just a moment…") run before your page exists, so no script sees them. Their outcomes are in Cloudflare's GraphQL Analytics API (`firewallEventsAdaptive`, actions such as `managedChallenge` and `managedChallengeInteractiveSolved`), which needs an API token and a server. The `ip` from `cloudflare()` joins them to analy events.

## Privacy and consent

Nothing protective is on by default; each piece is one option:

- `redact()` blanks secrets and emails and drops form values, contact addresses and IPs.
- `respectPrivacySignals: true` keeps tracking off for Global Privacy Control and Do Not Track.
- `persist: 'session'` (the default) recognises no returning visitors.

`consent: 'pending'` holds up to 100 events in memory and writes nothing to storage until `consent('granted')`. `consent('denied')` drops them and wipes stored ids. analy does not remember the choice; your consent banner calls `consent()` on each page.

## Writing plugins and sinks

```ts
import type { Plugin, Sink } from 'analy-js';

const copies = (): Plugin => ({
  name: 'copies',
  setup(analy) {
    const onCopy = () => analy.track('copy', { chars: String(getSelection() ?? '').length });
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  },
  // Optional: edit or drop (return null) every event before it is queued.
  enrich: (event) => event,
});

const dataLayer: Sink = {
  name: 'gtm',
  send: (events) => events.forEach((e) => window.dataLayer.push({ event: `analy.${e.name}`, ...e.props })),
};
```

Plugin hooks: `on('leave')` fires before an SPA navigation starts a new page view; `on('hide', ({ final }) => …)` fires when the page is hidden (`final` on unload) and is where summary events go; `on('event')` sees every queued event. A sink that returns a promise has its rejections reported to `onError`.
