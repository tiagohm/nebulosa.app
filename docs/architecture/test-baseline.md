# Test Baseline

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The commands and when to run them are those of `AGENTS.md` (Tooling, Verification Before Finishing); this section records what they do not say.

- CI (`.github/workflows/test.yml`, Ubuntu, Bun canary) installs with `--frozen-lockfile`, writes an empty catalog with `bun make:catalog --empty` and placeholder Moon assets with `bun make:moon --empty`, an empty meteor shower catalog with `bun make:meteors --empty`, an empty camera model catalog with `bun make:cameras --empty`, an empty telescope model catalog with `bun make:telescopes --empty`, then runs `bun fmt --check`, `bun lint`, and `bun test --timeout 30000 --parallel --pass-with-no-tests --timings timings.json`, limited with `--changed=<base>` to the tests the changes since the base commit reach whenever that commit is known and no change lies outside the modules (the `core` pointer, the lockfile, a manifest, the TypeScript, Bun, or lint configuration, or a workflow runs every test).
- The simulator tests that take long (Auto Focus, TPPA, DARV, the pointing model sessions and corrections, Image Stacking, the composition) are skipped unless `RUN_ALL_TESTS=true`;
  `bun test:timings` runs every test with it and updates the committed `timings.json`.
- The smoke test of `bun compile` runs the executable from a directory outside the repository: from its root, a worker the executable fails to embed is still found among the sources.
  The executable is built with code splitting (`app/build.ts`), so the code the server and its workers share, the ephemeris tables of the toolkit above all, is embedded once instead of in every worker that reaches it.
  The executable is built with `compile.trim` (`app/build.ts`), which without `aot` removes only the `bun` command line from the runtime (about 69 MB), so the executable cannot run as `bun`.
  With `aot` it would also remove the Bun and Node.js APIs the compiler cannot see in use, and a call to one only fails in the executable, with `ERR_FEATURE_REMOVED`, never under `bun test`.
  The executable is built with full minification and the React Compiler (`app/build.ts`), which needs Bun 1.4.5 or a canary since oven-sh/bun#47316: earlier versions drop the constants that syntax minification inlines into the template literals of components and hooks, a failure `bun dev` cannot show.
- `bun test` preloads `api/src/test.preload.ts` (`bunfig.toml`), which points `NEBULOSA_HOME` to a temporary directory of each test process, so no default path of a test reaches `~/Nebulosa`;
  a test of a store opens its own database (`AppDatabase.memory()`, or a temporary file to reopen).
  `api/src/persistence.test.ts` guards that operational state stays in the database (see [Persistence and State](persistence-and-state.md)).
- `api` tests drive devices through the `SIMULATOR` connection (`mounts.test.ts`, `operations.test.ts`, among others);
  the INDI property service runs against a fake `indiserver` over TCP that writes the protocol XML, the simulator, and an Alpaca server of the toolkit (`indi.test.ts`), and the INDI message service against the same kind of fake server (`indimessages.test.ts`).
- `web` tests are pure store and logic tests with an injectable fetch: every store, session, and io object takes an `ApiFetch` of `web/src/http.ts`, whose default is `browserFetch`, and a test passes a fake.
- Hardware tests with real motion are run separately and only with explicit authorization.
