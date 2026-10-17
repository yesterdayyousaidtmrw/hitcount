# Working on hitcount (for coding agents)

Read [docs/reference.md](docs/reference.md) for behaviour and [docs/testing.md](docs/testing.md) for the test tools.

## Commands

- `npm run check`: typecheck, regenerate docs, all tests, build with size budgets. Run before saying done.
- `npm run harness:ci`: real-browser check in headless Chrome. Run after touching `src/script/`, the core, or a plugin's DOM handling.
- `npm run fuzz`: 3,000 random runs. Run after touching consent, storage, the queue or a plugin.

## Layout

- `src/core/`: tracker, identity, storage, queue, hooks. No DOM-specific tracking here.
- `src/plugins/`: one file per plugin. A plugin only uses the `Hitcount` API it is given.
- `src/sinks/`: destinations. `src/server.ts`: the HTML-only pixel helper (no DOM).
- `src/script/`: the script-tag builds. `lite.ts` is `hitcount.min.js`, `full.ts` is `hitcount.full.min.js`.
- `src/events.ts`: props of every built-in event. `track()` type-checks against it.

## Rules

- Never edit `schema/*.json` or `docs/openapi.json` by hand. They are generated from the types by `scripts/schema.mjs`; change the types and run `npm run docs`.
- A new built-in event needs its props type in `src/events.ts` and an entry in `BuiltInEvents`. The contract test fails until the event is produced in `test/schema.test.ts`.
- A new plugin goes in `src/index.ts`, `src/script/full.ts` (and `lite.ts` only if it should be on by default), `test/fuzz/config.ts`, and `docs/reference.md`.
- Naming (enforced by `test/naming.test.ts`): event names and SQL/row columns snake_case, every JSON property and config key camelCase. Context every event can carry goes top level; details of one event name go in `props`.
- `schema/analysis.sql` views are tested on real Postgres (PGlite) in `test/analysis.test.ts`; a new column or event they read needs a case there.
- Nothing is hidden or turned off by default. Privacy features are opt-in (`redact()`, `respectPrivacySignals`).
- Size budgets in `scripts/build.mjs` are deliberate. Raise one only for a feature that is worth the bytes, and say so.
- Plugins must not throw into the page: wrap anything that can fail (storage, cookies, cross-origin access) and fall back.
- Tests first: write the failing test, watch it fail for the right reason, then fix.
