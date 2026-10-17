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
| `dist/hitcount.min.js` | pageviews, engagement, clicks, forms, traffic, device, channels, fingerprint | 11.5 KB |
| `dist/hitcount.full.min.js` | all of them; choose with `data-plugins` | 17.2 KB |

| Attribute | Default | |
| --- | --- | --- |
| `data-site` | `location.hostname` | Site id stamped on every event |
| `data-endpoint` | none | URL that receives `POST` batches. Without it, events go nowhere |
| `data-plugins` | the build's defaults | Comma list, or `all` |
| `data-persist` | `local` | `memory`, `session`, `local` or `cookie` |
| `data-consent` | `granted` | `pending` holds events until `hitcount.consent('granted')` |
| `data-cookie-domain` | none | e.g. `.example.com` to share ids across subdomains |
| `data-compress` | off | Gzip each batch (still `text/plain`, no preflight). Read it with `readBatch()` |
| `data-visitor-id` | none | Your own visitor id, e.g. from a first-party cookie your server sets |
| `data-respect-privacy-signals` | off | Stay off for visitors sending Global Privacy Control or Do Not Track |
| `data-debug` | off | Log every event to the console. `?hitcount_debug` in the URL does the same |
| `data-format` | `events` | Body format: `events`, `rows` or `ndjson` ([formats](#body-formats)) |
| `data-funnels` | none | JSON such as `{"signup":["/pricing","/signup","signup_completed"]}`; turns `funnels` on (full build) |

Every other [option](#options) works as an attribute too (`data-batch-size="20"`, `data-max-retries="0"`): booleans are on when present, numbers are parsed.

Calls made before the script loads are queued and replayed before the first page view:

```html
<script>window.hitcount=window.hitcount||function(){(hitcount.q=hitcount.q||[]).push(arguments)}</script>
<script>hitcount('set', { plan: 'pro' })</script>
```

After it loads, both `hitcount.track('signup')` and `hitcount('track', 'signup')` work.

### Configuring without attributes

Settings come from three places, merged key by key, later winning:

1. the tag's `data-*` attributes;
2. a `<script type="application/json" id="hitcount-config">` block anywhere in the page (before the tag, or the tag is `defer`/`async`);
3. `window.hitcountConfig`, set before the tag loads: the only place for functions (`beforeSend`, `onError`, a `format` function).

```html
<script type="application/json" id="hitcount-config">
{ "site": "blog", "endpoint": "https://collect.example.com/e", "format": "rows", "compress": true,
  "persist": "local", "consent": "pending", "batchSize": 20, "maxRetries": 5,
  "plugins": { "media": { "milestones": [10, 50, 90] }, "fingerprint": false, "search": true } }
</script>
<script>window.hitcountConfig = { beforeSend: (e) => (e.page.path.startsWith('/admin') ? null : e) };</script>
<script src="/hitcount.full.min.js" defer></script>
```

Keys are the [option](#options) names plus `endpoint`, `format`, `compress`, `headers` and `plugins`. A key set to `undefined` counts as unset.

`plugins` is `"all"`, `"pageviews,media"` or `["pageviews", "media"]` (exactly these), or an object that edits the choice so far (the build's defaults or an earlier source's list): `true` turns a plugin on, `false` off, and an options object turns it on with those options (`{ "media": { "milestones": [10] } }` runs `media({ milestones: [10] })`). Plugins still run in build order, so `redact` stays last. If a plugin rejects its options it runs with its defaults.

Bad config never breaks the page: invalid JSON, a source that is not an object, or a wrong-typed value (`"persist": "disk"`) gets one `[hitcount]` warning and is ignored. Unknown keys share one warning.

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
| `visitorId` | none | Your own visitor id. Used on every event whatever `persist` is; hitcount stores nothing for it and `reset()` keeps it |
| `sessionTimeoutMinutes` | `30` | Inactivity before a new session |
| `consent` | `'granted'` | Starting consent state |
| `respectPrivacySignals` | `false` | Stay off for visitors sending Global Privacy Control or Do Not Track |
| `batchSize` | `10` | Events per request |
| `flushIntervalMs` | `5000` | Longest wait before a partial batch is sent |
| `maxRetries` | `5` | Retries per failed batch before it is dropped; `0` turns retrying off |
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
| any `data-hitcount` name | clicks, forms | every `data-hitcount-*` attribute; forms add `values`, `completion`, `msInForm` |
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
| `funnel_step` | funnels | `funnel`, `step` (1-based), `stepName`, `steps` (total), `skipped`, `completed`, `msSinceStart`, `msSincePrevious` |
| `search` | search | `query`, `param`, `results` |
| `section_view` | sections | `section`, `timeToViewMs` |
| `dead_click` | deadclicks | `element`, `disabled` |
| `identify` | `identify()` | the traits you passed |

## Plugins

| Plugin | What it does | Options |
| --- | --- | --- |
| `pageviews()` | First page view, SPA navigation, and pages restored from the back/forward cache | `hash` to count `#route` changes |
| `engagement()` | Active time (visible + recent input) and scroll depth, sent when a page is hidden or left | `idleMs` (30 000) |
| `clicks()` | `data-hitcount` elements, outbound links, downloads, mailto/tel | `outbound`, `downloads`, `contact` |
| `forms()` | `<form data-hitcount="name">` on submit; `form_progress` per finished field; `form_snapshot` when the tab is hidden; `form_error` when the browser rejects a field; `form_abandon` for forms started and left ([details](#forms)). `data-hitcount-ignore` skips a form | |
| `traffic()` | Human / crawler / AI agent / automated tag ([how](#traffic-detection)) | `drop: ['crawler', …]` |
| `device()` | Browser, major version, OS, device type, connection, colour scheme | |
| `channels()` | Where a page view came from (`source`: direct, internal, search, social, ai, email, paid, referral), and where its session started (`attribution`, on every event) | |
| `fingerprint()` | Device hash on every event, read once per page after consent ([details](#unique-visitors)) | |
| `rageclicks()` | Repeated clicks on one spot (not triple-click text selection) | `clicks`, `withinMs`, `radiusPx` |
| `heatmap()` | Every click with page and in-element position | |
| `errors()` | Uncaught errors and unhandled rejections, deduplicated | `max` (10 per page load) |
| `vitals()` | Core Web Vitals from real visitors | |
| `media()` | `<video>`/`<audio>`: play, pause, 25/50/75% progress, complete, error, `stop` when the page is left mid-play, real watched time. Name a player with `data-hitcount`; muted looping autoplay and `data-hitcount-ignore` are skipped | `milestones` |
| `embeds()` | The same `media` events for YouTube and Vimeo iframes, with `provider`. YouTube needs `enablejsapi=1` in the iframe src, or `enableApi: true` (adds it and reloads the iframe). Name one with `data-hitcount`, skip one with `data-hitcount-ignore`. Works alongside your own YouTube IFrame API or GTM tracking | `milestones`, `enableApi` |
| `turnstile()` | Cloudflare Turnstile outcomes, implicit or explicit widgets | `fieldName` |
| `cloudflare()` | One event per session from `/cdn-cgi/trace`; silent off Cloudflare | `path` |
| `search()` | One `search` per page view whose URL has a site-search param. Put `data-hitcount-results="12"` on the results page for the count, read once results settle (a new count appears, 2 s pass, or the view ends) | `params` (`q`, `query`, `s`, `search`, `keyword`, `term`) |
| `sections()` | `section_view` the first time, per page view, that `ratio` of a `data-hitcount-view="pricing"` element stays on screen for `visibleMs`. Background-tab time does not count. Lower `ratio` for sections taller than the screen | `ratio` (0.5), `visibleMs` (1000) |
| `funnels()` | `funnel_step` each time a session gets further through a declared funnel ([details](#funnels)) | `funnels: { name: [steps…] }` |
| `deadclicks()` | `dead_click` when a plain click on a link, button, `[role=button]`, `[onclick]` or `data-hitcount` element changes nothing (DOM, URL, scroll, focus, form, navigation) within `waitMs`. Links the browser follows are never dead | `waitMs` (1000) |
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

The fingerprint is read on a session's first page and kept in `hitcount.store` for the rest of the session, so later pages cost nothing. Count unique visitors with `visitor_id`, and use `fingerprint_id` (where `fingerprint_scrambled` is false) to join visitors who cleared storage.

## Destinations (sinks)

| Sink | |
| --- | --- |
| `http(url, { headers?, format?, compress? })` | POSTs each batch; `sendBeacon` while the page unloads. `format` is `events`, `rows`, `ndjson` or a function; `compress: true` gzips it |
| `supabase({ url, key, table? })` | Inserts flat rows through Supabase's REST API |
| `callback(fn)` | Hands each batch to your function |

Batches sent by `http()` are a JSON array with `content-type: text/plain`, which needs no CORS preflight and works with `sendBeacon`. Parse the body as text. With custom headers the body is `application/json` and the browser sends a preflight first.

For Supabase, run [`../schema/postgres.sql`](../schema/postgres.sql) first. Its policy lets the public key insert and nothing else. `toRow(event)` gives the same flat row for any SQL database.

Delivery is at least once. A batch that fails with a network error, 408, 429 or 5xx waits in that sink's outbox and is sent again after 2 s, 10 s, 30 s, then every 2 minutes, up to `maxRetries` times; then it is dropped and reported to `onError`. Any other 4xx is dropped and reported at once. The outbox holds the newest 100 events per sink, each once, and is saved when the page is hidden so the next page retries it (after consent; in memory only with `persist: 'cookie'`). `reset()`, `consent('denied')` and `destroy()` empty it. The same event can arrive twice, so make inserts idempotent on `id`.

A custom sink gets retries by throwing or rejecting; an error with `retryable: false` drops the batch at once.

With `compress`, the body is gzipped where the browser has `CompressionStream`, and still sent as `text/plain`. Batches sent while the page unloads go uncompressed. On the server, `readBatch(request)` from `hitcount/server` reads every format, plain or gzipped (it checks for the gzip bytes `1f 8b`), and returns the array of events or rows. It rejects a body, or an NDJSON line, that is not JSON.

### Body formats

| `format` | Body |
| --- | --- |
| `events` (default) | `[{"schema":1,"id":"…","name":"pageview",…,"props":{}}]` |
| `rows` | `[{"id":"…","name":"pageview","site":"blog","visitor_id":"…","session_id":"…",…}]`: `toRow()` rows, column for column with `schema/postgres.sql` |
| `ndjson` | `{"schema":1,…,"name":"pageview",…}\n{"schema":1,…,"name":"engagement",…}\n`: one event per line |
| a function | the JSON of whatever it returns |

Without headers every format is sent as `text/plain` (no preflight). With headers it is `application/json`, or `application/x-ndjson` for `ndjson`.

## Funnels

```js
funnels({ funnels: { signup: ['/pricing', '/signup', 'signup_completed'] } })
```

- A step starting with `/` is a page path, matched against page views only: compared decoded (write `/über`), trailing slash ignored, `*` matches anything including `/` (`/docs/*/intro`). Any other step is an event name (`signup_completed`, a `data-hitcount` name, `identify`).
- An event moves the session to the first step past its current one that it matches; steps at or before the current one are ignored. `skipped` counts the steps passed over. On the last step (`completed: true`) progress resets, so the funnel can be entered again.
- Progress is per session, kept in `hitcount.store` (so it follows `persist` and consent). Timing uses the events' own times, so events held for consent keep their real gaps. `funnel_step` is sent right after the event that reached the step, in the same session; an event `beforeSend` drops never counts.
- Keep funnel names plain text; they become storage keys.

## Analysis SQL

[`../schema/analysis.sql`](../schema/analysis.sql) adds read-only views over `hitcount_events`. Run it after `postgres.sql`; it needs Postgres 15+ (the views are `security_invoker`, so Supabase's public key reads nothing through them).

| View or function | One row per |
| --- | --- |
| `hitcount_funnels` | site, funnel and step (including steps nobody reached): `step_name`, `sessions` reaching it, `entered` (sessions with any step), `pct_of_entered`, `drop_from_previous` (reached the step before, never this one) |
| `hitcount_flows` | site and `from_path` → `to_path` pair of consecutive page views in a session: `transitions`, `sessions` |
| `hitcount_entry_pages`, `hitcount_exit_pages` | site and path: sessions whose first / last page view it was |
| `hitcount_path_funnel(steps text[], site text default null, since timestamptz default '-infinity')` | step: `path`, `sessions` that viewed `steps[1]`, then later `steps[2]`, and so on. Works from page views alone, no plugin needed |

```sql
select * from hitcount_path_funnel(array['/pricing', '/signup', '/welcome'], 'blog', now() - interval '30 days');
```

## What goes top-level vs in props

- **Top level:** context any event can carry, set once by the core or a plugin, never per call: `site`, `visitor`, `session`, `user`, `page`, `device`, `utm`, `source`, `attribution`, `traffic`, `fingerprint`.
- **`props`:** details that belong to one event name, such as engagement's `activeMs` or form_progress's `field`. Built-in names have their props typed in `src/events.ts`.
- **Naming** (enforced by `test/naming.test.ts`): event names and table columns are snake_case (`form_progress`, `page_view_id`); JSON property names are camelCase at every depth, and so are config keys (`viewId`, `timeToViewMs`, `batchSize`).

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

- `turnstile()` reports each widget's `shown`, `clicked` (an interactive challenge), `solved` (with time to solve) and `expired`, by watching the hidden response field Turnstile fills in, so keep `response-field` on. `solved` means a token was issued; only siteverify on your server proves it valid. For error codes and timeouts, call `hitcount.track('turnstile', …)` from Turnstile's own `error-callback` / `timeout-callback`.
- `cloudflare()` reads `/cdn-cgi/trace` once per session. `clearance: true` means the `cf_clearance` cookie was readable, so a Cloudflare challenge was passed recently.
- Challenge pages ("Just a moment…") run before your page exists, so no script sees them. Their outcomes are in Cloudflare's GraphQL Analytics API (`firewallEventsAdaptive`, actions such as `managedChallenge` and `managedChallengeInteractiveSolved`), which needs an API token and a server. The `ip` from `cloudflare()` joins them to hitcount events.

## Privacy and consent

Nothing protective is on by default; each piece is one option:

- `redact()` blanks secrets and emails and drops form values, contact addresses and IPs.
- `respectPrivacySignals: true` keeps tracking off for Global Privacy Control and Do Not Track.
- `persist: 'session'` or `'memory'` stops recognising returning visitors; leaving `fingerprint` out of `data-plugins` (or adding `redact()`) drops the device hash.

`consent: 'pending'` holds up to 100 events in memory and writes nothing to storage until `consent('granted')`. `consent('denied')` drops them and wipes stored ids. hitcount does not remember the choice; your consent banner calls `consent()` on each page. The fingerprint is not read until consent is granted.

In the EU and UK (ePrivacy, PECR), storing a visitor id and reading a device fingerprint both need the visitor's prior consent, as cookies do. Getting it is the site owner's job: use `data-consent="pending"` and call `hitcount('consent', 'granted')` from your banner.

## Writing plugins and sinks

```ts
import type { Plugin, Sink } from 'hitcount';

const copies = (): Plugin => ({
  name: 'copies',
  setup(hitcount) {
    const onCopy = () => hitcount.track('copy', { chars: String(getSelection() ?? '').length });
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  },
  // Optional: edit or drop (return null) every event before it is queued. Use the hitcount passed here,
  // not one saved in setup: enrich can run before your setup (pageviews tracks from its own).
  enrich: (event, hitcount) => event,
});

const dataLayer: Sink = {
  name: 'gtm',
  send: (events) => events.forEach((e) => window.dataLayer.push({ event: `hitcount.${e.name}`, ...e.props })),
};
```

Plugin hooks: `on('leave')` fires before an SPA navigation starts a new page view; `on('hide', ({ final }) => …)` fires when the page is hidden (`final` on unload) and is where summary events go; `on('event')` sees every queued event. A sink that returns a promise has its rejections reported to `onError`.

`hitcount.store` gives a plugin `get`/`set`/`remove` for string values that follow consent and `persist`: memory until consent is granted, then the chosen storage under `_hitcount_x_<key>`. `reset()` and `consent('denied')` remove every key used on the page.
