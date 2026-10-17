# Testing hitcount

```bash
npm install
```

```bash
npm run check
```

`check` typechecks, regenerates the docs, runs every test (including 200 fuzz runs) and builds with size budgets. CI runs `npm run ci`, which fails instead of regenerating when the committed docs are stale.

| Script | What it does |
| --- | --- |
| `npm test` | Unit, contract and server tests plus 200 seeded fuzz runs |
| `npm run fuzz` | 3,000 fuzz runs from a random seed |
| `npm run fuzz:all` | One fuzz run for each of the 32,768 plugin combinations |
| `npm run harness` | Serves the fixture sites at `http://localhost:4174/harness/` for any browser |
| `npm run harness:ci` | Runs the harness in headless Chrome and exits 0 when every fixture passes |
| `npm run docs` | Regenerates `docs/openapi.json` and `schema/*.json` from the TypeScript types |
| `npm run docs:lint` | Lints `docs/openapi.json` with Redocly |
| `npm run build` | Builds `dist/` and fails if a bundle grows past its gzipped budget |

## Contract tests

`test/schema.test.ts` runs every plugin through one visit and checks each event against `schema/event.v1.json` and each flat row against `schema/row.v1.json`. It fails if a built-in event name is never produced, so a new plugin cannot ship undocumented.

## Fuzzer

`test/fuzz/` generates a random config (storage mode, consent, privacy signals, blocked storage, batch size, plugin subset, failing sinks, `beforeSend`) and a random visit of 5–40 actions: custom events, navigation, consent changes, clicks, form input, scrolling, tab switches, errors, Turnstile widgets, media playback, time jumps and `destroy()`. After each visit it checks that:

- nothing ever throws into the page, and `onError` only hears about the deliberately broken sinks
- every event and row matches the schemas, and event ids are unique
- consent and privacy signals are obeyed event by event
- storage is only written for the chosen mode, and only after consent
- `redact()` never lets a planted email or token through
- nothing is sent after `destroy()`

Runs are seeded. A failure prints its seed; replay it with:

```bash
FUZZ_SEED=12345 FUZZ_RUNS=1 npx vitest run test/fuzz.test.ts
```

## Harness

`scripts/harness.mjs` serves `harness/sites/*.html`, receives their events on `/collect` (and `/pixel` for the HTML-only page), validates each against the schema, and reports per fixture. `harness/fixtures.json` lists each site and the events it must produce:

| Fixture | Checks |
| --- | --- |
| basic | A bare HTML page with one script tag |
| async | No `<head>`, async script at the end of `<body>` |
| spa | Navigation with `pushState` |
| form | A `data-analy` form, submitted |
| csp | A strict Content-Security-Policy |
| no-storage | localStorage, sessionStorage and cookies all throw |
| media | An `<audio>` element played to the end |
| html-only | No JavaScript: image pixels only |
| shadow | A web component: tagged button, outbound link and form inside an open shadow root |

`npm run harness:ci` runs the fixtures in headless Chrome. `HARNESS_BROWSERS=chromium,firefox,webkit npm run harness:ci` runs them in each browser in turn; a browser that is not installed fails with the command to install it, and the harness never downloads one itself.

`--examples` saves one real event per name to `docs/examples.json`; the next `npm run docs` turns them into OpenAPI examples.
