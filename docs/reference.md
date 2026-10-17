# hitcount reference

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
| `dist/analy.min.js` | pageviews, engagement, clicks, forms, traffic, device, channels, fingerprint | 6.7 KB |
| `dist/analy.full.min.js` | all of them; choose with `data-plugins` | 9.5 KB |

| Attribute | Default | |
| --- | --- | --- |
| `data-site` | `location.hostname` | Site id stamped on every event |
| `data-endpoint` | none | URL that receives `POST` batches. Without it, events go nowhere |
| `data-plugins` | the build's defaults | Comma list, or `all` |
| `data-persist` | `local` | `memory`, `session`, `local` or `cookie` |
| `data-consent` | `granted` | `pending` holds events until `analy.consent('granted')` |
| `data-cookie-domain` | none | e.g. `.example.com` to share ids across subdomains |
| `data-visitor-id` | none | Your own visitor id, e.g. from a first-party cookie your server sets |
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
| `persist` | `'local'` | Where ids live (below) |
| `cookieDomain` | none | For `persist: 'cookie'` |
| `visitorId` | none | Your own visitor id. Used on every event whatever `persist` is; analy stores nothing for it and `reset()` keeps it |
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
| `local` (default) | localStorage | yes |
| `cookie` | first-party cookie, optional `cookieDomain` | yes, across subdomains |

Where the chosen storage is blocked, ids fall back to memory and tracking carries on.

## Events

```json
{
  "schema": 1,
  "id": "6f1c…", "name": "pageview", "time": "2026-10-16T12:00:00.000Z", "site": "my-site", "visitor": "4d7a…", "session": "b2e0…",
  "page": { "url": "https://example.com/pricing?utm_source=chatgpt.com", "path": "/pricing", "title": "Pricing", "referrer": "https://chatgpt.com/", "viewId": "91aa…" },
  "device": { "language": "en-GB", "timezone": "Europe/London", "screen": "1512x982", "viewport": "1512x861", "touch": false,
              "userAgent": "Mozilla/5.0 …", "browser": "Safari", "browserVersion": "18", "os": "macOS", "deviceType": "desktop", "colorScheme": "dark" },
  "utm": { "source": "chatgpt.com" },
  "source": { "channel": "ai", "name": "chatgpt.com" },
  "attribution": { "channel": "ai", "name": "chatgpt.com", "landing": "/pricing", "utm": { "source": "chatgpt.com" } },
  "traffic": { "kind": "human", "signals": [] },
  "fingerprint": { "id": "9b121a746b77b1dcbe663fc08a445432", "scrambled": false, "reasons": [] },
  "props": {}
}
```

`visitor` is on every event unless `persist` is `memory` or `session` (or `visitorId` was given), `user` appears after `identify()`, `attribution` and `source` come from `channels()`, `fingerprint` from `fingerprint()`. All events in one page view share `page.viewId`. `visitor` is any string: a uuid unless you passed your own `visitorId`.

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
| any `data-analy` name | clicks, forms | every `data-analy-*` attribute; forms add `values`, `completion`, `msInForm` |
| `form_abandon` | forms | `form`, `fieldsTouched`, `lastField`, `values`, `completion`, `msInForm` |
| `form_progress` | forms | `form`, `field`, `position`, `filled`, `total`, `msOnField`, `value` |
| `form_snapshot` | forms | `form`, `fieldsTouched`, `lastField`, `filled`, `total`, `completion`, `msInForm`, `values` |
| `form_error` | forms | `form`, `field`, `reason`, `message` |
| `rage_click` | rageclicks | `element`, `clicks` |
| `heatmap_click` | heatmap | `element`, `x`, `y`, `pageWidth`, `pageHeight`, `elementX`, `elementY` |
| `error` | errors | `kind`, `message`, `source`, `line`, `column`, `stack` |
| `vitals` | vitals | `lcp`, `cls`, `inp`, `fcp`, `ttfb`; keep the last per `viewId` |
| `media` | media | `action` (`play`, `pause`, `progress`, `complete`, `stop`, `error`), `kind`, `media`, `src`, `position`, `duration`, `muted`, `watchedSeconds`, `percent`, `code`, `provider` (`youtube`/`vimeo`, from embeds) |
| `turnstile` | turnstile | `status` (`shown`, `clicked`, `solved`, `expired`), `widget`, `ms` |
| `cloudflare` | cloudflare | `colo`, `country`, `ip`, `http`, `tls`, `warp`, `clearance` |
| `search` | search | `query`, `param`, `results` |
| `section_view` | sections | `section`, `timeToViewMs` |
| `dead_click` | deadclicks | `element`, `disabled` |
| `identify` | `identify()` | the traits you passed |

## Plugins

| Plugin | What it does | Options |
| --- | --- | --- |
| `pageviews()` | First page view, SPA navigation, and pages restored from the back/forward cache | `hash` to count `#route` changes |
| `engagement()` | Active time (visible + recent input) and scroll depth, sent when a page is hidden or left | `idleMs` (30 000) |
| `clicks()` | `data-analy` elements, outbound links, downloads, mailto/tel | `outbound`, `downloads`, `contact` |
| `forms()` | `<form data-analy="name">` on submit; `form_progress` per finished field; `form_snapshot` when the tab is hidden; `form_error` when the browser rejects a field; `form_abandon` for forms started and left ([details](#forms)). `data-analy-ignore` skips a form | |
| `traffic()` | Human / crawler / AI agent / automated tag ([how](#traffic-detection)) | `drop: ['crawler', …]` |
| `device()` | Browser, major version, OS, device type, connection, colour scheme | |
| `channels()` | Where a page view came from (`source`: direct, internal, search, social, ai, email, paid, referral), and where its session started (`attribution`, on every event) | |
| `fingerprint()` | Device hash on every event, read once per page after consent ([details](#unique-visitors)) | |
| `rageclicks()` | Repeated clicks on one spot (not triple-click text selection) | `clicks`, `withinMs`, `radiusPx` |
| `heatmap()` | Every click with page and in-element position | |
| `errors()` | Uncaught errors and unhandled rejections, deduplicated | `max` (10 per page load) |
| `vitals()` | Core Web Vitals from real visitors | |
| `media()` | `<video>`/`<audio>`: play, pause, 25/50/75% progress, complete, error, `stop` when the page is left mid-play, real watched time. Name a player with `data-analy`; muted looping autoplay and `data-analy-ignore` are skipped | `milestones` |
| `embeds()` | The same `media` events for YouTube and Vimeo iframes, with `provider`. YouTube needs `enablejsapi=1` in the iframe src, or `enableApi: true` (adds it and reloads the iframe). Name one with `data-analy`, skip one with `data-analy-ignore`. Works alongside your own YouTube IFrame API or GTM tracking | `milestones`, `enableApi` |
| `turnstile()` | Cloudflare Turnstile outcomes, implicit or explicit widgets | `fieldName` |
| `cloudflare()` | One event per session from `/cdn-cgi/trace`; silent off Cloudflare | `path` |
| `search()` | One `search` per page view whose URL has a site-search param. Put `data-analy-results="12"` on the results page for the count, read once results settle (a new count appears, 2 s pass, or the view ends) | `params` (`q`, `query`, `s`, `search`, `keyword`, `term`) |
| `sections()` | `section_view` the first time, per page view, that `ratio` of a `data-analy-view="pricing"` element stays on screen for `visibleMs`. Background-tab time does not count. Lower `ratio` for sections taller than the screen | `ratio` (0.5), `visibleMs` (1000) |
| `deadclicks()` | `dead_click` when a plain click on a link, button, `[role=button]`, `[onclick]` or `data-analy` element changes nothing (DOM, URL, scroll, focus, form, navigation) within `waitMs`. Links the browser follows are never dead | `waitMs` (1000) |
| `redact()` | Blanks secret URL params (`token`, `code`, `password`…) and emails in `page`, `utm`, `attribution` and props; drops `values`, `address`, `ip`, the `fingerprint`, and what was typed in `form_progress` `value` and `form_error` `message`. Add it last | `params` |

## Forms

- `form_progress` is sent each time a visitor finishes a field: a `change`, or leaving the field with a changed value. One edit sends one event. `position` is 1-based, or `null` for a field the form does not count.
- Counted fields are named and enabled, and are not hidden inputs or buttons. A radio group, or checkboxes sharing a name, count as one. `value` is the file names for a file input, and for a checkbox or radio the value while checked, else `''`.
- `form_snapshot` is sent when the tab is hidden, for each started, unsubmitted form that changed since its last snapshot. Phones often unload a hidden tab without `pagehide`, so this keeps partial progress. `form_abandon` still fires only on an SPA page change or a real unload.
- `form_error` is sent when the browser rejects a field (its `invalid` event): `reason` is the first failing `ValidityState` check (`valueMissing`, `typeMismatch`, `tooShort`…), `message` the browser's text.
- Submit events and `form_abandon` carry `completion` (0–100, `null` when the form has no named fields) and `msInForm` (since the first focus or input; `null` on a submit with neither).
- Forms inside open shadow roots are tracked from the first focus. An input whose own shadow root holds the `<input>` reports progress but not `form_error`, since its `invalid` event stays inside the component.

## Unique visitors

Two ids, both on by default:

- `visitor`: a random id in localStorage (`persist: 'local'`), the same on every visit until storage is cleared. Pass `visitorId` / `data-visitor-id` to use your own, e.g. from a first-party cookie your server sets, since Safari caps script-written storage at 7 days.
- `fingerprint: { id, scrambled, reasons }`: a 32-character hash of canvas, WebGL renderer, installed fonts, screen, colour depth, pixel ratio, CPU cores, memory, timezone, languages, platform and touch points. It survives cleared storage. `scrambled: true` means the browser adds noise to resist fingerprinting (`reasons`: `canvas-noise`, `brave`, `resist-fingerprinting`); the id can then change between visits, so do not use it to link them. `canvas-unavailable` and `webgl-unavailable` make the id less unique but not unstable.

Count unique visitors with `visitor_id`, and use `fingerprint_id` (where `fingerprint_scrambled` is false) to join visitors who cleared storage.

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
import { eventFromPixel, PIXEL_GIF, PIXEL_HEADERS } from 'hitcount/server';

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
- `persist: 'session'` or `'memory'` stops recognising returning visitors; leaving `fingerprint` out of `data-plugins` (or adding `redact()`) drops the device hash.

`consent: 'pending'` holds up to 100 events in memory and writes nothing to storage until `consent('granted')`. `consent('denied')` drops them and wipes stored ids. analy does not remember the choice; your consent banner calls `consent()` on each page. The fingerprint is not read until consent is granted.

In the EU and UK (ePrivacy, PECR), storing a visitor id and reading a device fingerprint both need the visitor's prior consent, as cookies do. Getting it is the site owner's job: use `data-consent="pending"` and call `analy('consent', 'granted')` from your banner.

## Writing plugins and sinks

```ts
import type { Plugin, Sink } from 'hitcount';

const copies = (): Plugin => ({
  name: 'copies',
  setup(analy) {
    const onCopy = () => analy.track('copy', { chars: String(getSelection() ?? '').length });
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  },
  // Optional: edit or drop (return null) every event before it is queued. Use the analy passed here,
  // not one saved in setup: enrich can run before your setup (pageviews tracks from its own).
  enrich: (event, analy) => event,
});

const dataLayer: Sink = {
  name: 'gtm',
  send: (events) => events.forEach((e) => window.dataLayer.push({ event: `analy.${e.name}`, ...e.props })),
};
```

Plugin hooks: `on('leave')` fires before an SPA navigation starts a new page view; `on('hide', ({ final }) => …)` fires when the page is hidden (`final` on unload) and is where summary events go; `on('event')` sees every queued event. A sink that returns a promise has its rejections reported to `onError`.

`analy.store` gives a plugin `get`/`set`/`remove` for string values that follow consent and `persist`: memory until consent is granted, then the chosen storage under `_analy_x_<key>`. `reset()` and `consent('denied')` remove every key used on the page.
