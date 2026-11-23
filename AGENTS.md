# AGENTS.md

## Scope and Project Overview

These instructions apply to the whole repository except `core/`, which is a git submodule governed by its own `core/AGENTS.md`.

Nebulosa is an integrated astronomical imaging application: a Bun server and a React UI shipped together as a single standalone executable.

- Runtime, package manager, bundler, test runner, type checker, linter, and formatter: **Bun** (`bun lint` and `bun fmt` are OXC-based built-ins)
- Modules: **ESM only**, TypeScript everywhere
- Frontend: React 19, Tailwind CSS 4, `tailwind-variants`, `cn`, and `valtio`
- Monorepo: Bun workspaces `core`, `api`, `web`, `app`, and `bin`

Use the user's task to determine the authorized outcome:

- A review, audit, diagnosis, or explanation is read-only unless the user also asks for a change.
- An implementation request includes the smallest necessary source, test, and documentation updates.
- Do not broaden a task into an unrelated refactor, compatibility layer, remote operation, or cleanup.

## Architecture Reference

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the base documentation of the whole architecture: its core (the glossary, the layer map, the rules every feature shares, how a feature is added) and an index of the documents under `docs/architecture/`, one per feature or cross-cutting reference. Read the core and the documents a task touches before designing a change, and treat them as binding alongside this file.

What the documents hold, and only this:

- **What it is**: the feature or mechanism in a few sentences, with its workspace and main modules as pointers into the code.
- **Why it exists**: the operator's need it answers and its importance in the app.
- **Relations**: what it uses and what uses it: other features, services, devices it holds, the toolkit, external services, persisted data, and the workspace that hosts it.
- **Rules and limitations**: the invariants other features rely on and the limitations that change how it is used.

They never describe layout, styles, labels, wording, field lists, route paths and parameters, error codes, event payloads, constants, cadences, algorithm steps, or any other detail the code already states; the code is the reference for those.

Update a document in the same commit only when a change makes it wrong or incomplete in one of those four points: a feature is added, removed, or renamed; its purpose changes; it starts or stops using another feature, service, device, external service, or kind of persisted data; it moves to another workspace; an ownership boundary or a shared rule changes; or a documented rule or limitation appears, changes, or goes away. A change of UI, styling, wording, an internal algorithm, a route, a payload, an error code, or a fix that leaves the description true changes no document. A new feature is a new document under `docs/architecture/`, listed in the index of `docs/ARCHITECTURE.md`. Do not leave a document describing behavior the code no longer has.

## Working Principles

- Inspect live code, configuration, and nearby patterns before editing. Treat plans and prior descriptions as hypotheses until verified.
- Make the smallest cohesive change that fully solves the task. Avoid parallel architectures, speculative abstractions, and compatibility wrappers.
- Deliver finished production code: no TODOs, placeholders, debug artifacts, or partially wired behavior.
- Preserve unrelated worktree changes. If task files are already modified, understand and retain those edits rather than overwriting them.
- Reuse the existing stack and the `nebulosa` toolkit. Add a dependency only when they cannot solve the problem and its startup, bundle, and binary-size costs are justified.
- Do not introduce unrelated formatting, generated files, logs, or local-only configuration.

## Workspaces and Dependency Boundaries

- `core/` (package `nebulosa`): the astronomy toolkit, a git submodule of [`nebulosa.ts`](https://github.com/tiagohm/nebulosa.ts). Its `postinstall` extracts the native libraries, which is why it is listed in the root `trustedDependencies`.
- `api/`: the Bun backend. `src/index.ts` is the package entry point and exports the HTTP `routes`.
- `web/`: the React frontend. `index.html` is the HTML entry point and is exported as `web/index.html`; sources live in `src/` and static files in `assets/`.
- `app/`: composes `api` and `web` into one `Bun.serve` server (`src/server.ts`, imported by the entry point `src/main.ts` once it applied the command line to the environment), and builds the executable (`build.ts`, `tailwind.plugin.ts`).
- `bin/`: development scripts that generate data files, such as `src/sky.catalog.ts`, which writes the sky catalog database zstd-compressed, `api/data/sky.catalog.db.zst`, embedded by `api`, `src/moon.assets.ts`, which writes the Moon color maps and surface feature catalog `web/assets/moon/` bundled by `web`, `src/camera.models.ts`, which writes the camera model catalog `web/assets/cameras.json.gz` bundled by `web`, `src/telescope.models.ts`, which writes the telescope model catalog `web/assets/telescopes.json.gz` bundled by `web`, `src/hips.surveys.ts`, which writes the survey catalog of the Framing tool `web/assets/hips.surveys.json.gz` bundled by `web`, and `src/quad.index.ts`, which writes the quad index files of the built-in plate solver `bin/data/quads/<source>/` from Gaia DR3 or a local ASTAP or HNSKY star database, read by the application from the index folder set in Settings → External Tools → Nebulosa; that page also downloads bands built from ASTAP D20 into the default index folder `quad-indexes/` of the data directory, searched when the index folder is empty.

Preserve these boundaries:

- `api` may import `nebulosa`; it never imports `web` or `app`.
- `web` may import from `api` only with `import type`. Runtime communication goes through HTTP or WebSocket, never through shared runtime modules, so server code never ends up in the browser bundle.
- `web` never imports `nebulosa` runtime code that relies on Bun, the filesystem, and native FFI. Complex computation that needs the toolkit belongs in `api`. Constants and pure functions like angle formatting can be imported.
- `app` only wires `api` and `web` together and owns the build. Business logic belongs in `api`, UI in `web`.
- `bin` may import `api` (through its package `exports`) and `nebulosa`; nothing imports `bin`. Schemas and codes shared by a generator and the API live in `api`.
- Import `nebulosa` modules by path, such as `nebulosa/src/math/units/angle`; the package has no barrel.
- Across workspaces import by package name (`api`, `web/index.html`, `nebulosa/src/...`). Within a workspace use relative imports without `.ts` extensions.

### The `core` Submodule

- Do not edit files under `core/` from this repository unless the user explicitly asks; toolkit changes belong in the `nebulosa.ts` repository and follow `core/AGENTS.md`.
- When the right fix belongs in the toolkit (a missing option, hook, or listener of a `core` service), prefer changing `core` over working around it in `api` or `web` (subclassing, prototype tricks, or reimplementing toolkit behavior). Before editing `core`, ask the user for permission, describing the change and why it is better than handling it here; edit only after they agree.
- Moving the submodule pointer is a deliberate change: commit it on its own and say which upstream commit it points to.
- After cloning or switching branches, run `git submodule update --init` before `bun install`.
- `core/` is excluded from this repository's `bun lint`, `bun fmt`, `bun test`, and TypeScript projects.

## Tooling

Run every command from the repository root.

- Install: `bun install` (commit `bun.lock`; CI installs with `--frozen-lockfile`)
- Sky catalog: `bun make:catalog` (add `--force` to regenerate) after installing and whenever its schema changes. It downloads the source files and queries SIMBAD; the generated `api/data/sky.catalog.db.zst` is not committed, and `bun dev`, `bun start`, `bun compile`, and `bun test` need it. `bun make:catalog --empty` writes the schema without downloading or querying anything, which is enough for tests; a later `bun make:catalog` replaces that placeholder without `--force`.
- Moon assets: `bun make:moon` (add `--force` to regenerate) after installing. It downloads the NASA color maps and the USGS feature archive once into `bin/data/moon`; the generated `web/assets/moon/` is not committed, and `bun dev`, `bun start`, and `bun compile` need it. `bun make:moon --empty` writes placeholders without downloading anything, which is enough for tests; a later `bun make:moon` replaces them without `--force`.
- Meteor shower catalog: `bun make:meteors` (add `--force` to download it again) after installing. It downloads the IAU Meteor Data Center stream catalog; the generated `api/data/meteor.showers.json.gz` is not committed, and `bun dev`, `bun start`, `bun compile`, and `bun test` need it. `bun make:meteors --empty` writes an empty catalog without downloading anything, which is enough for tests; a later `bun make:meteors` replaces it without `--force`.
- Camera model catalog: `bun make:cameras` (add `--force` to download it again) after installing. It reads the cameras and sensors of the AstroBin equipment database through the toolkit's AstroBin client; the generated `web/assets/cameras.json.gz` is not committed, and `bun dev`, `bun start`, and `bun compile` need it. `bun make:cameras --empty` writes an empty catalog without downloading anything, which is enough for tests; a later `bun make:cameras` replaces it without `--force`.
- Telescope model catalog: `bun make:telescopes` (add `--force` to download it again) after installing. It reads the telescopes and lenses of the AstroBin equipment database through the toolkit's AstroBin client; the generated `web/assets/telescopes.json.gz` is not committed, and `bun dev`, `bun start`, and `bun compile` need it. `bun make:telescopes --empty` writes an empty catalog without downloading anything, which is enough for tests; a later `bun make:telescopes` replaces it without `--force`.
- Survey catalog: `bun make:surveys` (add `--force` to download it again) after installing. It asks the CDS MocServer for the all-sky image surveys hips2fits serves, with their title and credit; the generated `web/assets/hips.surveys.json.gz` is not committed, and `bun dev`, `bun start`, and `bun compile` need it. `bun make:surveys --empty` writes an empty catalog without asking anything, which is enough for tests; a later `bun make:surveys` replaces it without `--force`.
- Quad index: `bun make:quads` (add `--force` to build and download again) builds the `.nqi` quad index files of the built-in plate solver and their `manifest.json` in `bin/data/quads/gaia-dr3/` from Gaia DR3, downloaded from the ESA Gaia archive and cached in `bin/data/gaia/`; nothing is committed. A full run downloads the whole catalog to the magnitude limit (hours, gigabytes) and is not part of `bun make`; `--region ra,dec,radius` (degrees) and `--bands` (band minima, arcseconds) restrict it, and an interrupted run resumes. `bun make:quads --catalog astap --path <directory>` (or `hnsky`, with `--database` when the directory holds several) builds them offline from a local star database into `bin/data/quads/<catalog>-<database>/`. `bun make:quads --empty` writes an empty manifest without downloading anything.
- Development server with hot reload and frontend HMR: `bun dev`. A change of `web/` only reloads the page; a change of `api/` or `core/` evaluates the server again, which stops the running operations and in-memory sessions and reopens the connections, so avoid it during a capture
- Production-mode server without compiling: `bun start`
- Standalone executable: `bun compile`, written to `.dist/nebulosa.exe` on Windows and `.dist/nebulosa` elsewhere
- Lint and type-check: `bun lint` (type-aware, runs with `--disable-nested-config` so `core/` is skipped), never run `bunx tsc`
- Lint with fixes: `bun lint --fix`
- Format: `bun fmt`, or `bun fmt <explicit paths>` for touched files
- Check formatting: `bun fmt --check`
- Tests: `bun test --parallel --timeout 30000`, or `bun test --timeout 30000 <file>` for one file

Runtime and build notes:

- The server listens on `--host` and `--port` when the command line gives them (`bun dev --port 7001`, `nebulosa --host 0.0.0.0`), else on `APP_HOST` (default `localhost`) and `APP_PORT` (default `7000`). `NODE_ENV=production` disables HMR and the development console. `--home` when the command line gives it (`bun dev --home ./data`), else `NEBULOSA_HOME` (default `~/Nebulosa`), is the data directory: the operational database `nebulosa.sqlite`, captures, the calibration library, the IERS tables, and the downloaded quad index files. In production (`bun start` and the executable) only one server can use a data directory at a time; `bun dev` leaves the database open to other processes, such as a database browser.
- `bun dev` enables React Fast Refresh only when `react-refresh/runtime` resolves from the repository root. The isolated install keeps `react` inside `web/node_modules`, so `react-refresh` is a root `devDependency`. Without it, the HMR runtime only rebinds imports, and a component held by a module-level registry (such as `TOOL_DEFINITIONS`) keeps rendering its old version until the page is reloaded.
- `bun compile` inlines `APP_*` variables present at build time and forces `NODE_ENV=production`. The executable loads `.env` but not `bunfig.toml`.
- Tailwind runs through `app/tailwind.plugin.ts`: registered in the root `bunfig.toml` under `[serve.static]` for `bun dev` and `bun start`, and passed directly to `Bun.build` in `app/build.ts`. Keep both paths working when changing either one.
- `web/src/index.css` scans `web/` through `@import 'tailwindcss' source('..')`. Add a `@source` directive if classes ever live outside `web/`.
- Do not introduce npm, Yarn, pnpm, Vite, PostCSS, Prettier, ESLint, another test runner, or another bundling layer.

### Dependencies

- Add a dependency to the workspace that imports it, never to the root. The root only holds shared tooling such as `@types/bun`.
- Pin exact versions (`.npmrc` sets `save-exact`). React, Tailwind, and other UI packages belong to `web`; build-only packages belong to `app` as `devDependencies`.
- Reference sibling workspaces with `workspace:*`.
- Keep `bun.lock` in the same commit as the `package.json` change that caused it.

## TypeScript, Formatting, and Runtime Style

Follow the OXC configuration (`.oxfmtrc.json`, `.oxlintrc.json`) and `.editorconfig`: tabs, single quotes, no semicolons, sorted imports, LF endings.

- Every workspace `tsconfig.json` extends the root one; change shared compiler options only at the root.
- Keep strict types. Avoid `any`, unchecked assertions, and lint or type suppressions when `unknown`, generics, or narrowing work.
- Always type function and method parameters. Add explicit return types for public structured results and API payloads.
- Prefer `interface` for structured objects and `type` for unions, tuples, and aliases.
- Prefer `undefined` for absence. Use `null` only when an external protocol or JSON payload requires it.
- Prefer discriminated unions and string-literal states over enums.
- Use `import type`, `export type`, `satisfies`, and `as const` where they preserve intent and inference.
- Await promises. Mark intentional fire-and-forget work with `void` and explicit error handling.
- Throw only `Error` instances. Normalize unknown failures at API boundaries.

### Backend (`api`)

- Expose endpoints as `Bun.serve` routes under `/api/`; respond with `Response.json` and meaningful status codes.
- Release timers, sockets, device connections, and in-flight work when a request, connection, or session ends.
- No input (request bodies, query strings, uploaded files, device and network messages) should be validated. Assume that the caller will always send the valid values.
- Never call "crypto.randomUUID", use Bun.randomUUIDv7 instead.

### Frontend (`web`)

- Write function components with named exports. Keep components small and colocate them with the feature that uses them.
- Style with Tailwind utility classes in `className`. Use `tv` from `tailwind-variants` for component variants and `cn` to merge class names; do not add CSS-in-JS or CSS modules.
- Keep shared client state in `valtio` proxies; keep transient UI state in React state.
- Reference static assets relative to the importing HTML or module so Bun can hash and bundle them.
- Never use aria-* attributes.
- Avoid using size="sm" on buttons, unless it is highly recommended for the layout.
- Never call "crypto.randomUUID", use nanoid instead.
- Never use "sr-only" or anything related to screen readers.

## Documentation Comments

Use concise repository-style `//` comments that explain contracts, not syntax.

- Start every new source file with a module description immediately after imports, or at the top when there are none. Describe its responsibility.
- Keep a file's module description current when its responsibility changes.
- Add a documentation comment above every function, method, class, interface, type alias, enum, and module-level constant, public or private.
- Describe intent, every parameter, return semantics, side effects, valid domain.
- State units for angles, distances, times, rates, temperatures, pressure, magnitudes, and pixel coordinates.
- Explain a constant's physical or algorithmic meaning, unit, source when known, and valid range.
- Describe every interface property adjacent to the property, including units and constraints where relevant.
- Do not comment obvious assignments, loop mechanics, or control flow.

Tests do not need documentation comments.

## Tests

- Use `bun:test` and name test files `*.test.ts` or `*.test.tsx` inside the workspace they cover.
- Write the smallest deterministic test that proves the behavior at the right seam: pure tests for logic, route-level tests for `api` handlers.
- Mock only true external or nondeterministic boundaries such as devices, network services, and time.
- Do not duplicate toolkit tests; numerical correctness of `nebulosa` is tested in `core`.

## Verification Before Finishing

Verification is proportional to the change, but the touched area must have zero introduced TypeScript or lint errors and passing relevant tests.

The app is in development and all of its data is test data: the database, settings, equipment setups, captures, and calibration library under `NEBULOSA_HOME`, and the data directory itself. Verify against them freely, creating, changing, or deleting whatever a check needs; never skip or narrow a verification to keep them intact. Only hardware tests with real motion still need explicit authorization.

- Documentation-only changes: `bun fmt --check` and `git diff --check`.
- TypeScript changes: the closest targeted tests, `bun lint`, `bun fmt --check`, and `git diff --check`.
- Changes to `app/`, bundling, Tailwind, `bunfig.toml`, `package.json`, or HTML entry points: also run `bun compile` and smoke-test the executable (`/api/health` and the UI load with styles).
- UI changes: run `bun dev` and check the affected screen in a browser.
- Report every skipped or failed verification command and its exact reason, and distinguish pre-existing failures from ones introduced by the task.
- Confirm `docs/ARCHITECTURE.md` and the documents under `docs/architecture/` still describe the change truthfully, updating them only as the Architecture Reference says.
- Keep the credits of the About page (`CREDIT_GROUPS` of `web/src/about/about.ts`) current: a change that starts, changes, or stops the use of an external service, dataset, published model or method, protocol, or bundled library or program adds, updates, or removes its entry in the same commit, with the license or acknowledgment its publisher asks for. Check a citation against its publisher before writing it.
- Review the final diff and status before staging.

## Code Review

A review request is read-only. Do not edit, stage, commit, push, or resolve remote threads unless the user separately requests those actions.

Report only actionable findings supported by code evidence: correctness, security at untrusted boundaries, lifecycle and resource leaks, workspace boundary violations, bundle or binary regressions, and material performance problems. Do not report style, naming, or formatting preferences, speculative alternatives, or pre-existing issues unrelated to the change.

Order findings by severity (`P0` catastrophic, `P1` likely bug in normal use, `P2` edge case, `P3` minor or performance), and give for each the file and line, the failing scenario, why it matters, a concrete fix, and the minimal regression test.

## Git and Commit Workflow

For every completed task that changes tracked files, create a local commit unless the user explicitly says not to commit. Do not create empty commits.

Before committing:

- Inspect `git status --short` and review the unstaged diff.
- Stage task files explicitly by path; never rely on `git add .` or `git add -A`.
- Inspect `git diff --staged` and commit only after relevant checks pass.
- Never stage the `core` submodule pointer unless updating it is the task.

Authorization boundaries:

- A request to commit does not authorize a push. Pushes, PRs, comments, and remote thread resolution each require explicit authorization.
- Never amend, squash, rebase, or rewrite existing commits unless explicitly requested.
- Preserve and leave unstaged all unrelated user changes.

### Commit Messages

Write precise English commit messages with:

1. an imperative subject, normally lowercase, preferably no more than 72 characters and without a trailing period;
2. exactly one blank line;
3. a body explaining why the change exists and any important side effects, limitations, or trade-offs;
4. exactly one blank line;
5. a `Co-Authored-By: Name <email>` trailer for the authoring agent.

Do not use Conventional Commit prefixes. Avoid vague subjects such as `fix bug`, `update code`, `misc`, or `wip`. Mention breaking changes explicitly.
