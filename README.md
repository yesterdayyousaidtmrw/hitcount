# analy

**Lightweight analytics you own.** Add one script tag to any website and every visit, click and scroll becomes a clean JSON event, sent wherever you want: your own API, a Supabase table, or a function you write. No account, no vendor, no dashboard you are locked into.

> `analy-js` is a working name; the package is not on npm yet.

## Why analy

- **Small.** About 7 KB, with no dependencies, and you only load the plugins you use.
- **Yours.** Events go straight from the visitor's browser to your endpoint or database. Nothing passes through anyone else.
- **Works anywhere you can add a script tag:** plain HTML, site builders, single-page apps. Pages that can't run JavaScript can use an image pixel instead.
- **Tells people from bots.** Every event says whether it came from a person, a search crawler, an automated browser or an AI agent. Page views also show when someone arrived from ChatGPT, Claude, Perplexity or Gemini.

## Get started

**1. Add the script.** Build it with `npm run build`, copy `dist/analy.min.js` to your site, and add this before `</body>`:

```html
<script src="/analy.min.js" data-endpoint="https://your-api.example/collect" defer></script>
```

**2. Check it works.** Open any page with `?analy_debug` at the end of the URL. Every event appears in the browser console as it happens.

**3. Receive the events.** Your endpoint gets a `POST` with a JSON array of events every few seconds. Not sure what to point it at? See [Where your data goes](#where-your-data-goes).

That is all it takes. Out of the box you get:

- page views, including navigation in single-page apps
- how long people actually spent on each page, and how far they scrolled
- clicks on outbound links, downloads, and email or phone links
- form submissions, and forms people started but abandoned
- where visitors came from: search, social, email, AI assistants, ad campaigns
- browser, operating system, device type and screen size
- whether the visitor is a person, a crawler, an automated browser or an AI agent

## Track what matters to you

### No code needed

Add `data-analy` to anything people click or submit. Extra `data-analy-*` attributes become details on the event.

```html
<button data-analy="start_trial" data-analy-plan="pro">Start free trial</button>

<form data-analy="newsletter">
  <input name="email" type="email">
  <button>Subscribe</button>
</form>
```

### From your own code

```js
analy.track('purchase', { plan: 'pro', amount: 49 });
analy.identify('user_123');   // ties later events to a signed-in user
analy.reset();                // on logout
```

### More plugins

Swap `analy.min.js` for `analy.full.min.js` (9.5 KB) and choose extras with `data-plugins`:

```html
<script src="/analy.full.min.js" data-endpoint="…" data-plugins="pageviews,engagement,clicks,forms,media,vitals,errors" defer></script>
```

| Plugin | Adds |
| --- | --- |
| `media` | Video and audio: plays, pauses, how far people got, and real time watched |
| `vitals` | Page speed as your visitors experience it (Core Web Vitals) |
| `errors` | JavaScript errors your visitors hit |
| `rageclicks` | Spots where people click repeatedly in frustration |
| `heatmap` | The position of every click, for heatmaps |
| `turnstile` | Whether visitors pass your Cloudflare Turnstile check, and how long it takes |
| `cloudflare` | Country and Cloudflare data centre for each visitor, if your site runs behind Cloudflare |
| `redact` | Hides emails, passwords, tokens and form values before anything is sent |

Every plugin, option and event is listed in the [reference](docs/reference.md).

## Where your data goes

**Your own endpoint.** Any server that accepts a `POST` will do. A Cloudflare Worker, for example:

```js
export default {
  async fetch(request) {
    const events = JSON.parse(await request.text());
    // save them wherever you like
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  },
};
```

**Supabase, with no server.** Run [`schema/postgres.sql`](schema/postgres.sql) in the Supabase SQL editor, then send events straight to the table:

```js
import { createAnaly, supabase, pageviews, engagement, clicks } from 'analy-js';

createAnaly({
  sinks: [supabase({ url: 'https://your-project.supabase.co', key: 'your-publishable-key' })],
  plugins: [pageviews(), engagement(), clicks()],
});
```

The table only lets the public key add rows: it cannot read, change or delete anything.

**Anywhere else.** Hand events to your own function with `callback()`, or describe your API's format with `http(url, { format })`. The exact request your endpoint receives is documented in [`docs/openapi.json`](docs/openapi.json).

## Pages without JavaScript

If a page can't run your script, or you'd rather not add one, an invisible image counts the visit:

```html
<img src="https://your-api.example/p.gif?site=blog" referrerpolicy="unsafe-url" width="1" height="1" alt="">
```

Put a second one with `loading="lazy"` and `&e=read` near the end of a long article to count people who read to the bottom. On your server, `eventFromPixel(request)` from `analy-js/server` turns each hit into the same kind of event the script sends, so both land in one table. Details are in the [reference](docs/reference.md#pages-without-javascript).

## Privacy: your choice

analy collects what you ask it to and nothing is hidden by default. Turn on what your site needs:

- **Hide personal data:** add the `redact` plugin. It blanks emails, passwords, tokens and form values before anything leaves the browser.
- **Honour "do not track":** add `data-respect-privacy-signals` to stay off for visitors whose browser asks not to be tracked.
- **Wait for consent:** add `data-consent="pending"`, then call `analy.consent('granted')` from your cookie banner. Nothing is sent or stored until then.
- **Returning visitors:** by default analy uses no cookies and forgets visitors when they close the tab. Set `data-persist="local"` or `"cookie"` to recognise them next time.

## Compatibility

- **Any site you can add a script tag to**, including sites with a strict Content-Security-Policy and visitors who block cookies and storage.
- **Modern page loading:** pages Chrome prerenders are only counted once someone actually opens them, and pages restored with the back button count as a new view.
- **Browsers:** built for browsers from 2020 onward (Chrome and Edge 80+, Firefox 74+, Safari 13.1+). The automated browser tests run in Chrome.

| Script | Size (gzipped) |
| --- | --- |
| `analy.min.js` (default) | 6.7 KB |
| `analy.full.min.js` (all plugins) | 9.5 KB |
| npm, core with page views only | 3.1 KB |

## How it compares

| | analy | Plausible | Umami | PostHog |
| --- | --- | --- | --- | --- |
| Script size | 6.7 KB | ~1 KB | ~2 KB | tens of KB |
| Built-in dashboard | no, use your own | yes | yes | yes |
| Events are stored | wherever you send them | in Plausible (cloud or self-hosted) | in Umami (cloud or self-hosted) | in PostHog (cloud or self-hosted) |
| Session replay, feature flags, A/B tests | no | no | no | yes |

Choose analy when you want raw events in your own system, shaped your way, plus things the others do not focus on: telling people from bots and AI agents, AI-assistant referrals, media and Turnstile tracking, and a no-JavaScript pixel that feeds the same table. Choose one of the others when you want ready-made charts.

## Documentation

- [Reference](docs/reference.md): every option, plugin and event
- [Event format](docs/openapi.json): what your endpoint receives, generated from the code
- [Testing](docs/testing.md): tests, the fuzzer and the browser harness
- [AGENTS.md](AGENTS.md): instructions for AI coding agents working on this repo

## Contributing

```bash
npm install
```

```bash
npm run check
```

`check` runs the type checker, every test and the build. See [docs/testing.md](docs/testing.md) for the fuzzer and the real-browser harness.

## License

[MIT](LICENSE)
