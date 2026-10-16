# Wave 1: compatibility, analytics, reliability

Out of scope: the dashboard, a reference collector, CI and publishing.

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

## Order

1. B1–B4 run in parallel, each in its own worktree from the baseline commit (at most 4 at once).
2. B2 adds `analy.store`, a small key/value store that obeys `persist` and consent. B5 builds on it, so B5 starts after B2 is merged.
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
