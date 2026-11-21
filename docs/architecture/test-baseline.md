# Test Baseline

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

What the tests rely on beyond the commands and verification rules of [`AGENTS.md`](../../AGENTS.md).

- CI (`.github/workflows/test.yml`) installs with a frozen lockfile, writes the empty placeholders of the generated catalogs and assets, then checks formatting, lints, and runs the tests, limited to those the changes reach unless a change lies outside the modules.
- The simulator tests that take long are skipped unless `RUN_ALL_TESTS=true`; `bun test:timings` runs every test with it and updates the committed `timings.json`.
- `bun test` preloads `api/src/test.preload.ts`, which points `NEBULOSA_HOME` to a temporary directory of each test process, so no test reaches `~/Nebulosa`; a test of a store opens its own database.
- `api` tests drive devices through the `SIMULATOR` connection, and the INDI services run against a fake `indiserver` that writes the protocol.
- `web` tests are pure store and logic tests: every store, session, and io object takes an injectable `ApiFetch` (`web/src/http.ts`), and a test passes a fake.
- The smoke test of `bun compile` runs the executable from a directory outside the repository, since from its root a worker the executable failed to embed is still found among the sources.
- The executable is trimmed without `aot`, so it only cannot run as `bun`; with `aot`, a call to an API the compiler cannot see in use would fail only in the executable, never under `bun test`.
- The minification and React Compiler of the executable need Bun 1.4.5 or a canary that has its fix; an earlier Bun drops constants inlined into components, a failure `bun dev` cannot show.
