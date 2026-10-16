# Wave 1: compatibility, analytics, reliability

Out of scope: a dashboard UI, a reference collector, CI and publishing.

## Items

| # | Item | Builder |
| --- | --- | --- |
| C1 | Clicks and forms inside web components (open shadow roots) are tracked | B1 |
| C2 | SPAs that navigate with the Navigation API get page views | B1 |
| C3 | Safari's 7-day cap on script-set storage: accept a server-provided visitor id (`visitorId` / `data-visitor-id`) | B1 |
| C4 | Harness runs in Chrome, Firefox and WebKit (`HARNESS_BROWSERS`); Firefox/WebKit need a one-time Playwright browser download, which waits for the maintainer's OK | B1 |
| A1 | First-touch attribution on every event: where the session started (channel, source, landing page, utm) | B2 |
| A2 | Site search: `search` event with the query and, when marked, the result count | B2 |
| A3 | Section views: `data-analy-view="pricing"` sends `section_view` once seen | B3 |
| A4 | Dead clicks: a click on something clickable where nothing happens | B3 |
| A5 | YouTube and Vimeo embeds report the same `media` events as `<video>` | B4 |
| R1 | Failed batches are kept and retried (backoff, cap, survives navigation where storage is allowed) | B5 |
| R2 | Optional gzip of batches, plus a server helper that reads both forms | B5 |
| F1 | `funnels` plugin: declared steps (paths or event names) send `funnel_step` with step number, timing, skips and completion; progress kept per session via `analy.store`; `data-funnels` on the script tag | B6 |
| F2 | `schema/analysis.sql`: funnel conversion and drop-off, page-to-page flows, entry and exit pages; tested on real Postgres (PGlite) | B6 |
| U1 | Unique visitors on by default: default `persist` becomes `local` (stored visitor ID) | B7 |
| U2 | `fingerprint` plugin, on by default in `analy.min.js`: device hash (canvas, WebGL, fonts, screen, hardware, locale), computed after consent; every event carries `fingerprint: { id, scrambled, reasons }`; noise detected by double-rendering, plus Brave / Firefox resist-fingerprinting / Safari signs; noisy parts left out of the hash; columns in the row and SQL | B7 |
| F3 | Form progress, on by default: `form_progress` per finished field (field, position, filled/total, time on field, value); partial snapshot on tab hide so phone app-switches are not lost; `form_error` for browser validation failures (field, reason); completion % and time in form on submit and `form_abandon` | B8 |
| K1 | Script-tag config with no npm: `<script type="application/json" id="hitcount-config">` for every option and per-plugin options, plus `window.hitcountConfig` for functions such as `beforeSend` | B9 |
| K2 | Output presets: `format: "events" | "rows" | "ndjson"` on `http()` and via config | B9 |
| K3 | Naming rule enforced by a test: event names snake_case, JSON fields camelCase, row columns snake_case; reference section on what goes top-level vs in `props` | B9 |

## Order

1. B1–B4 run in parallel, each in its own worktree from the baseline commit (at most 4 at once).
2. B2 adds `analy.store`, a small key/value store that obeys `persist` and consent. B5 and B6 build on it, and B7 changes the same core files as B1 and B2, so B5–B7 start after B1 and B2 are merged. B8 edits `src/plugins/forms.ts`, which B1 also changes, so it starts after B1 is merged. B9 edits `src/script/boot.ts` and `src/sinks/http.ts`, so it starts after B1 and B2 are merged and is coordinated with B5 (also in `http.ts`).
3. Each builder commits code and tests only. Generated files (`schema/*.json`, `docs/openapi.json`) and prose docs are done once, at merge.

## Done means

- Every item has a test that failed before the change and passes after.
- The contract test produces every new built-in event and validates it against the regenerated schema.
- The fuzzer covers each new plugin, and `npm run fuzz:all` passes over every plugin combination.
- `npm run ci` is green, `npm run harness:ci` passes in Chrome, and the OpenAPI spec lints clean.
- Sizes are reported; budgets are raised only on purpose.
- README, `docs/reference.md` and `docs/testing.md` describe the new behaviour.

## Merge

Cherry-pick one builder at a time onto `main`, resolve the shared registrations (`src/index.ts`, `src/script/full.ts`, `src/events.ts`, `test/fuzz/config.ts`, `test/schema.test.ts`), regenerate the docs, then run the full gate once.
