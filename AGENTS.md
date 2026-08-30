# AGENTS.md

## Scope and Project Overview

These instructions apply to the whole repository unless a nested `AGENTS.md` provides narrower rules.

Nebulosa App is a Bun-first, ESM-only TypeScript astronomy application with a Bun runtime/API and a React web UI for planning, device control, image capture, processing, and visualization.

- Runtime, package manager, builder, and test runner: **Bun**
- Modules: **ESM only**
- UI: **React 19**
- Styling: **Tailwind CSS v4** through `tailwind.plugin.ts`
- Browser state and orchestration: **Valtio** through `src/web/hooks/store.hook.ts`
- Astronomy, imaging, and device functionality: **nebulosa**

The codebase is organized by runtime boundary: Bun-only code in `src/api`, runtime-neutral contracts and helpers in `src/types`, `src/shared`, and `src/lib`, and browser code in `src/web`. Tests under `tests/` mirror the production boundary they exercise.

Use the user's task to determine the authorized outcome:

- A review, audit, diagnosis, or explanation is read-only unless the user also asks for a change.
- An implementation request includes the smallest necessary source, test, documentation, and example updates.
- Do not broaden a task into an unrelated refactor, compatibility layer, remote operation, or cleanup.

## Working Principles

- Inspect live code, tests, configuration, and nearby patterns before editing. Treat plans and prior descriptions as hypotheses until verified.
- Make the smallest cohesive change that fully solves the task. Avoid parallel architectures, speculative abstractions, and compatibility wrappers unless the task requires them.
- Deliver finished production code: no TODOs, placeholders, debug artifacts, temporary branches, or partially wired behavior.
- Preserve unrelated worktree changes. If task files are already modified, understand and retain those edits rather than overwriting them.
- Treat numerical correctness, physical meaning, unit consistency, lifecycle behavior, performance, and memory use as first-class requirements.
- Avoid broad refactors while fixing local issues.
- Update affected tests and examples whenever behavior or public contracts change.
- Reuse the existing stack and local primitives. Add a dependency only when they cannot solve the problem and its startup, bundle, binary, and operational costs are justified.
- Do not introduce unrelated formatting, generated files, logs, fixtures, or local-only configuration.

## Code Discovery

This repository uses `codebase-memory-mcp`. Prefer graph discovery when it is available and current:

1. `list_projects` and `index_status` to identify the project and index health on first use.
2. `search_graph` to locate functions, classes, constants, interfaces, and types.
3. `trace_path` for callers, callees, dependencies, data flow, and impact.
4. `get_code_snippet` to read an exact symbol after discovery.
5. `search_code` for scoped text or JSX usage searches.
6. `query_graph` and `get_architecture` for broader structural questions.
7. `check_index_coverage` before relying on negative or exhaustive graph claims.

The graph is an index, not source authority. Read the exact implementation and nearby tests before editing. If the MCP service is unavailable, stale, partial, or cannot answer the query, continue with `rg` and direct source inspection rather than blocking the task.

Use `rg` first for string literals, errors, configuration, documentation, generated data, and filesystem-oriented searches. Re-run `bun run index` after major module additions, moves, route changes, or broad symbol changes; routine local edits are watched automatically.

## Repository Map and Dependency Boundaries

- `main.ts`: startup, CLI/environment normalization, dependency wiring, route registration, WebSocket setup, and `Bun.serve`.
- `build.ts` and `tailwind.plugin.ts`: production build and Tailwind integration.
- `src/api/`: Bun-only handlers, services, device orchestration, integrations, and endpoint maps.
- `src/types/`: domain and transport contracts shared by runtime and browser.
- `src/shared/`: small runtime-neutral helpers and bus infrastructure.
- `src/lib/`: internal domain libraries that do not belong to a UI feature.
- `src/web/pages/`: HTML and React browser entry points.
- `src/web/ui/`: feature screens and composites.
- `src/web/ui/components/`: reusable UI primitives.
- `src/web/stores/`: Valtio feature stores and browser orchestration.
- `src/web/hooks/`: React hooks, including store lifecycle management.
- `src/web/shared/`: browser API, bus adapters, contexts, persistence, proxy, and utility helpers.
- `src/web/assets/` and `src/data/`: checked-in assets and runtime data.
- `tests/`: Bun tests mirroring the source boundary being tested.
- `bin/` and `scripts/`: data generation and maintenance utilities, including graph indexing.

Preserve these boundaries:

- `src/types`, `src/shared`, and `src/lib` must not import from `src/api` or `src/web`.
- `src/api` must not import from `src/web`. Keep browser APIs and presentation state out of runtime handlers and services.
- Browser code should consume server behavior through shared contracts plus HTTP, WebSocket, or runtime-neutral bus adapters. Do not add new `src/web` imports from `src/api`; move reusable events or contracts to `src/shared` or `src/types` when touching an existing exception.
- Keep filesystem, process, device, network, and other Bun-only side effects out of browser, presentation, and runtime-neutral modules.
- Keep `main.ts` focused on composition. Reusable behavior belongs in `src/api`, `src/lib`, or `src/shared`.
- Keep large image, database, catalog, and network payload paths streaming-friendly; avoid unnecessary materialization and deep cloning.

Project layout conventions:

- Add modules to the existing folder that owns the responsibility. Do not create a new top-level `src/` category without a clear architectural need.
- Keep `tests/` aligned with `src/` and prefer the closest existing test file.
- Prefer dot-separated related filenames within a domain, such as `store.hook.ts` and `ws.store.ts`, rather than shallow one-file subdirectories.
- Follow nearby imports and configured aliases: `root/*` for repository-root files, `src/*` for source-root files, `#/*` for `src/types`, and `@/*`, `@assets/*`, `@hooks/*`, `@shared/*`, `@stores/*`, and `@ui/*` for browser code.
- Use relative imports for close siblings and omit `.ts` extensions.
- Reuse existing handlers, commanders, stores, UI primitives, buses, and shared helpers before creating equivalents.

## Tooling

Use Bun for installs, scripts, tests, and local execution.

- Install: `bun install`
- Development: `bun dev`
- Production: `bun prod`
- Compile the executable: `bun run compile`
- Format touched paths: `bun run fmt -- <explicit paths>`
- Format the repository: `bun run fmt`
- Check formatting: `bun run fmt:check`
- Lint and type-check: `bun run lint`
- Lint with fixes: `bun run lint:fix`
- Refresh the code graph: `bun run index`
- Run the full suite: `bun test --parallel`
- Run test files affected by uncommited changes: `bun test --parallel --changed`
- Run one test file: `bun test tests/api/atlas.test.ts`

Tests use `bunfig.toml` with `tests/` as the test root.

- Prefer targeted tests before broader runs.
- Do not introduce npm, Yarn, pnpm, Vite, PostCSS, Prettier, ESLint, another test runner, or another bundling layer.
- Do not use `bun run compile` as a substitute for linting or type-checking.

### Python Reference Values

Use `uv` only as a development-time reference tool for Astropy, ERFA, NumPy, Skyfield, or similar trusted libraries.

- Do not invoke `python`, `pip`, or a manually managed virtual environment.
- Use `uv run --with <dependency> <script>` or a PEP 723 script so dependencies resolve reproducibly.
- Pin the epoch, timescale, observer, location, ellipsoid, units, and other inputs.
- Record the reference library and version near committed expected values or fixtures.
- Paste stable reference values into Bun tests; Python must not enter the runtime or test dependency path.
- Keep one-off scripts outside the repository unless reproducible fixture generation is itself part of the task.

## Runtime and API Architecture

### HTTP, WebSocket, and Integration Boundaries

- Parse and validate CLI arguments and `Bun.env` near startup, then pass typed configuration inward.
- Prefer Bun APIs such as `Bun.file`, `Bun.write`, `Bun.spawn`, and `Bun.serve`; confirm Bun compatibility before using Node-specific packages or APIs.
- Follow the existing `class XHandler` plus `function x(handler)` endpoint-map pattern. Return route objects with `as const satisfies Endpoints` and spread them into `routes` in `main.ts`.
- Use `query()` and `response()` from `src/api/http.ts`. Validate untrusted input once at the boundary and keep transport DTOs small and plain.
- Model expected failures with discriminated result unions rather than exceptions used as routine control flow.
- Reuse `WebSocketMessageHandler` for server-to-browser fanout; do not create another socket registry.
- Keep browser WebSocket ownership in `src/web/stores/ws.store.ts` and use the existing bus adapters for feature events.

### Device Orchestration and Lifecycle

- For coordinated device mutations, use the existing `*Commander`, `ResourceArbiter`, `OperationCoordinator`, `DeviceLifecycle`, and capture/session services. Do not introduce direct manager writes that bypass ownership, cancellation, conflict handling, or typed results.
- Acquire all required resources atomically before physical work. Nested work must remain in the parent operation or reservation scope instead of competing under a new owner.
- Treat operation start as transactional: a rejected or failed start must not leave a lease, listener, timer, pending task, or partially started device command behind.
- Propagate cancellation through nested operations and wait for registered cleanup before releasing resources. Cover success, failure, timeout, cancellation, disconnect, device removal, and shutdown.
- Quarantine or ignore late device events, BLOBs, and replies from obsolete attempts or sessions.
- Keep command state realistic: distinguish unavailable, busy/conflict, disconnected, Alert, cancelled, timed out, and successful outcomes.
- Intentional fire-and-forget device work must use the existing notification/detachment path and own its errors; a bare unhandled promise is not acceptable.

### Sequencer

- Keep shared sequencer contracts in `src/types/sequencer*.ts` and runtime behavior in the existing `src/api/sequencer.*.ts` modules.
- Preserve the staged flow from definition and preflight through compilation, resource resolution/reservation, execution, checkpointing, terminalization, and snapshot publication. Do not create a parallel execution path in an endpoint or UI store.
- Validate unknown block configuration through the registered handler before deriving resources or executing it. Pass the narrowed configuration through the existing compiler/runtime contracts.
- A session owns its reservation for its lifecycle. Cancel or drain all operation roots and await cleanup before releasing that reservation to another owner.
- Keep pause, resume, stop, shutdown, retries, and terminal actions serialized against the persisted state machine. Late actions from an obsolete attempt must not overwrite a newer state.
- Preserve durable artifact semantics: temporary write, format validation, atomic promotion, checkpoint update, and orphan cleanup remain one protocol.

## React and Browser Code

### Components

- Use function components and hooks. Use `.tsx` only when the file renders JSX.
- Keep renders pure; do not mirror props into state or derive state through effects.
- Prefer local state and narrow props. Subscribe with `useSnapshot` as low as practical and read only the fields being rendered.
- Preserve nearby declaration style: shared primitives commonly use named functions, while feature components commonly use `const Component = memo(...)`.
- React 19 accepts `ref` as a normal prop; do not introduce `forwardRef`.
- Do not add `useMemo` or `useCallback` by default. Use them only for measured hot paths or APIs that require stable references.
- Use stable data-derived keys. Clean up timers, subscriptions, observers, and interruptible async work; prefer `AbortController` when applicable.
- Use `startTransition`, `useDeferredValue`, `useEffectEvent`, lazy loading, Suspense, or virtualization only for a demonstrated interaction, stale-closure, bundle, or rendering problem.
- Do not add accessibility- or ARIA-specific work unless requested.

### Reusable UI and Tailwind

- Start with the closest primitive in `src/web/ui/components`. Keep feature-specific composites in `src/web/ui`.
- Use `Icons` from `src/web/ui/Icon.tsx` and `IconButton` for icon-only actions. Do not add an icon library without an explicit requirement.
- Add a primitive only when existing ones cannot express the product need. Keep it generic, controlled where practical, ref-capable, and in one file under `src/web/ui/components`.
- Match existing APIs and semantic variants such as `variant`, `color`, `size`, `disabled`, `readOnly`, `loading`, `fullWidth`, `startContent`, and `endContent`. Style supported states inside the primitive.
- Use local `tv()` definitions, typed slots or class overrides, and `tw()` from `src/web/shared/util.ts` where composition benefits from them.
- Keep Tailwind classes statically discoverable and sorted by OXC. Prefer CSS variables and `@theme` tokens; avoid dynamic partial utility names and arbitrary values without a measured reason.
- Preserve established geometry and focus treatment. Use neutral dark surfaces by default and accents for action, selection, or emphasis.
- Flatten fragments in compound child APIs. For large collections, prefer `itemCount` plus a renderer, following `List` and `Table`.
- Never add or expand HeroUI. It is legacy.

### Stores and Valtio

- Follow `src/web/hooks/store.hook.ts`; do not reintroduce Bunshi, molecule APIs, generic providers, or another store framework.
- Use one store per feature or domain. Keep transient UI state local and export specialized, concretely typed actions instead of a generic indexed update API.
- Singleton stores keep long-lived state at module scope and export `{ state, ...actions } as const`.
- Factory stores create `proxy(...)` inside `featureStore(...)`, export `type FeatureStore = ReturnType<typeof featureStore>`, and return `{ state, mount, unmount, ...actions } as const`.
- Instantiate factories with `useStore(() => featureStore(args), deps)`. Use `useStore(featureStore, [])` for lifecycle-aware singletons. Keep dependencies minimal and stable.
- Acquire subscriptions, timers, browser lifecycle hooks, and persistence in idempotent `mount`; release them in idempotent `unmount`. Collect cleanup functions and use `unsubscribe(...)` from `src/shared/util`.
- Use explicit contexts from `src/web/shared/context.ts` only when a subtree must share a particular store or device instance.
- Persist reload-surviving state through `initProxy`, `fillProxy`, `subscribeProxy`, `storageGet`, or `storageSet`; retain cleanup for scoped stores. Use `p:key` for primitive fields and `o:key` for object or proxy fields.

## TypeScript, Formatting, and Runtime Style

Follow OXC configuration: tabs, single quotes, no semicolons, trailing commas, sorted imports, LF endings, and the configured line width.

- Use TypeScript and ESM. Never add CommonJS.
- Preserve `// oxfmt-ignore` immediately above intentionally long imports and keep those imports on one line.
- Keep strict types. Avoid `any`, broad index signatures, unchecked assertions, and suppressions when `unknown`, generics, narrowing, or explicit shapes work.
- Always type function and method parameters.
- Prefer inference for primitive and tuple returns. Add explicit return types for public structured results or where inference would make a contract unclear or unstable.
- Prefer `interface` for structured public objects and `type` for unions, tuples, mapped types, and aliases.
- Use tuple aliases and readonly aliases for low-level numeric structures while preserving existing mutable-output conventions.
- Use `readonly` where it communicates API intent without fighting mutable-output hot paths.
- Prefer `undefined` for absence. Use `null` only when it has a distinct documented meaning or an external protocol requires it.
- Prefer exhaustive discriminated unions and camel-case string-literal states over enums unless runtime identity or an external contract requires an enum.
- Use `import type`, `export type`, `satisfies`, and `as const` when they preserve intent and inference.
- Await promises. Mark intentional fire-and-forget work with `void` and explicit error handling.
- Throw only `Error` instances. Normalize unknown failures at logging, protocol, and API boundaries.
- Use `performance.now()` for durations and `Date` for wall-clock timestamps.

Preserve established implementation patterns:

- Prefer top-level pure functions for math-heavy and transformation code.
- Use classes primarily for handlers, protocol clients, device managers, commanders, and other stateful integrations.
- Preserve optional mutable outputs in hot paths and document whether the return aliases the output.
- Prefer flat numeric layouts, stable object shapes, typed arrays, and reusable buffers for high-volume work.
- Keep portable numerical modules free of Bun- or Node-only APIs. Runtime integrations may use Bun, `Buffer`, timers, `fetch`, and `fs/promises` where nearby code does.

## Documentation Comments

These rules apply to production code under `src/`. Use concise repository-style `//` comments that explain contracts, not syntax.

- Start every new `src/` file with a module description immediately after imports, or at the top when there are none. Describe its responsibility, domain, units or conventions, and mutation or allocation behavior.
- Keep a file's module description current when its responsibility changes.
- Add a documentation comment above every function, method, class, interface, type alias, enum, and module-level constant.
- Describe intent, every parameter, return semantics, side effects, valid domain, and important edge cases without restating the signature.
- State units for angles, distances, times, rates, temperatures, pressure, magnitudes, and pixel coordinates.
- State coordinate frames, handedness, origins, axis directions, normalization, ordering, non-empty, monotonic, and other preconditions.
- For mutable outputs, document mutation, aliasing, and whether a fresh value is allocated when the output is omitted.
- Document approximations, tolerances, iteration limits, fallback behavior, precision trade-offs, and authoritative sources near the implementation.
- Explain a constant's physical or algorithmic meaning, unit, source when known, and valid range.
- Describe every interface property adjacent to the property, including units and constraints where relevant.
- Do not comment obvious assignments, loop mechanics, or control flow.

Tests do not need production-style documentation comments. Add test comments only when they preserve non-obvious fixture provenance, trusted reference versions, numerical intent, lifecycle timing, or a regression's physical reason.

## Validation Policy

The project deliberately performs little runtime validation for trusted, typed inputs. Callers are responsible for satisfying documented preconditions; validation is not a substitute for a precise contract.

Runtime validation is warranted only when:

1. It prevents a hang, non-convergence, stack overflow, process crash, or unbounded or accidentally huge allocation.
2. The types cannot express a structurally nonsensical state and continuing would silently produce a plausible-looking wrong result.

Untrusted boundaries are separate: validate network payloads, files, protocol messages, environment or process values, and third-party responses once when they enter the system.

For trusted internal and public function arguments, do not add checks merely for:

- numeric range, sign, index bounds, or angle normalization;
- union, enum, or discriminant membership already expressed by the type;
- `null`, `undefined`, or optional property presence already expressed by the type;
- object shape already expressed by TypeScript;
- `NaN` or `Infinity` inputs;
- array lengths, dimensions, non-emptiness, or sorting unless one of the two allowed failure modes actually applies.

A caller outside the documented domain gets whatever mathematical result the computation produces, but it still must not trigger the first failure mode above. Valid inputs must not produce non-finite public geometry, time, coordinate, image, or SVG results.

When validation is justified:

- Validate once at the operation entry point or external parsing boundary, never repeatedly in deeper trusted layers or hot loops.
- Reuse nearby parsers and validators; add a shared validator only when the check is genuinely reusable.
- Comment the concrete failure the check prevents.
- Do not use exceptions as routine state-machine or result control flow; prefer discriminated result unions for expected failures.
- In reviews, report the concrete hang, crash, unbounded work, or plausible wrong result, not "missing validation."

## Numerical and Physical Rules

- Angles are radians unless documented otherwise.
- Distances are AU unless documented otherwise.
- Velocities are AU/day unless documented otherwise.
- Time intervals use the local days-or-seconds convention; always document which.
- Temperature is degrees Celsius and pressure is millibar (`hPa`) unless documented otherwise.
- Pixel coordinates must document origin, extent convention, channel layout, CFA phase, and axis direction when relevant.
- Cache repeated trigonometric, ephemeris, projection, and coordinate-frame computations.
- Avoid subtracting nearly equal values when a stable formulation exists.
- Prefer `atan2`-based formulations over `acos` near `0` or `PI`.
- Clamp rounding-sensitive inverse-trigonometric inputs.
- Guard divisions when valid geometry can approach a singular denominator.
- Normalize vectors explicitly with existing vector helpers when required.
- Preserve angle wrapping deliberately and document whether output is `0..TAU`, `-PI..PI`, or unwrapped.
- Represent singular or undefined directions explicitly, usually with `undefined`.
- Use tolerances that match scale and conditioning; distinguish absolute, relative, angular, pixel, and time tolerances.
- Never fix a numerical regression by changing expected values before independently proving the new result.

## Performance and Memory

Optimize code paths that are hot, scale with realistic data, process large payloads, or run every simulation or render tick. Do not add complexity to cold code without evidence, and never trade away correctness or numerical stability for a micro-optimization.

### Algorithms and Data Layout

- Check asymptotic complexity before micro-optimizing.
- Replace repeated linear lookup with `Map`, `Set`, indexing, bucketing, or spatial structures when the scale justifies it.
- Preallocate when final size is known. Avoid sparse and heterogeneous arrays in critical paths.
- Prefer flat objects or typed arrays for large numeric datasets; do not convert typed arrays to regular arrays without need.
- Prefer `subarray()` when a view is enough and `slice()` only when a copy is required.
- Do not use argument spread for potentially large collections.
- Keep caches bounded or provide an eviction or size policy; use stable keys and do not memoize cheap work.

### Hot Loops and Numerical Work

- Hoist loop invariants, unit conversions, decoders, regular expressions, and repeated trigonometric, ephemeris, projection, or frame calculations.
- Avoid intermediate arrays from chained `map`, `filter`, or `reduce`, object or array spreads, closures, and temporary objects in measured hot loops.
- Reuse mutable outputs, workspaces, typed-array views, and buffers when ownership is clear.
- Compare squared distances when the distance itself is not needed; use direct multiplication for small integer powers.
- Avoid formatting, logging, JSON conversion, exceptions, and dynamic object reshaping in high-volume loops.
- Keep performance-motivated code readable and document non-obvious allocation or numerical trade-offs.

### Async, I/O, and Lifecycle

- Do not accidentally serialize independent I/O. Use bounded concurrency for large or untrusted batches.
- Stream large images, database files, catalogs, and network payloads when materialization is unnecessary.
- Reuse long-lived clients and expensive helpers where lifecycle ownership is explicit.
- Clean up timers, listeners, observers, sockets, pending requests, operations, and buffers on success, failure, cancellation, disconnect, and disposal.
- Quarantine or ignore late replies and events from obsolete operations or sessions.
- Avoid blocking the event loop with substantial CPU work; use an existing worker or offload pattern when one exists.

Before accepting a performance-sensitive change, verify complexity, allocation behavior, buffer reuse, concurrency bounds, cache growth, lifecycle cleanup, and readability. A performance review finding must identify realistic scale or frequency and a material effect.

## Tests

- Use `bun:test`; place tests under `tests/` mirroring source folders and module names.
- Add tests to the closest existing `*.test.ts` file when practical.
- Match nearby `test` and `expect` style.
- Write the smallest deterministic test that proves the behavior at the correct unit or integration seam.
- Prefer focused tests for pure logic and integration-style tests for handlers, services, parsers, serializers, adapters, protocols, I/O, and simulators.
- Mock only true external or nondeterministic boundaries. Keep fixtures small, explicit, isolated, and cleaned up.
- Cover success and typed failures at boundaries, including malformed external input, missing configuration, timeout, cancellation, and upstream failure.
- For devices and orchestration, cover capability absence, disconnect and reconnect, busy or conflict, Alert states, late events, cancellation ownership, cleanup, and boundary timing, not only the happy path.
- For sequencer work, cover preflight and runtime parity, resource reservation, pause and resume, graceful and immediate stop, retry exhaustion, terminal actions, checkpoint recovery, shutdown, and artifact cleanup when affected.
- Do not test that pure functions reject out-of-range or wrong-typed trusted inputs; that is outside the validation contract.
- Assert behavior precisely and avoid snapshot-heavy tests.
- Use `toBeCloseTo` or explicit tolerances for floating-point results. Use strict equality only for mathematically exact results.
- Cover relevant astronomical and geometric boundaries: zero vectors, near-zero separations, poles, zenith and nadir, horizon and antimeridian crossings, `0` or `TAU` wrap, grazing contact, degenerate or identity transforms, and validity-window endpoints.
- Do not add a browser or UI test stack. Mention a relevant UI coverage gap in the handoff when applicable.

## Verification Before Finishing

Verification is proportional to the change, but the touched area must have zero introduced TypeScript errors, passing relevant tests, and no obvious correctness or performance regression.

- Documentation-only changes: format-check the touched files, validate referenced paths and commands, and run `git diff --check`.
- TypeScript changes: run the closest targeted tests, `bun run lint`, `bun run fmt:check`, and `git diff --check`.
- Cross-cutting shared primitives, test infrastructure, broad refactors, or high-risk numerical, orchestration, or runtime changes: also run `bun test --parallel`.
- Runtime startup, environment, packaging, build, or Tailwind-plugin changes: also run `bun run compile`.
- Prefer `bun run fmt -- <explicit paths>` when the worktree contains unrelated edits. Use repository-wide `bun run fmt` only when its entire output is in scope, then inspect every formatted change.
- Re-run tests after any fix made in response to a failed check.
- Distinguish failures introduced by the task from pre-existing, fixture, network, timing, or platform failures. Establish overlap with touched code before treating a full-suite failure as a task regression.
- Do not commit with introduced failures or unresolved errors in the touched area.
- Report every skipped or failed verification command and its exact reason.
- Review the final diff and status before staging.

## Code Review

A review request is read-only. Do not edit, stage, commit, push, or resolve remote threads unless the user separately requests those actions.

Review changed code and directly affected contracts. Report only actionable findings supported by code evidence and tied to concrete correctness, numerical, algorithmic, physical, lifecycle, performance, or memory harm.

For pull-request work, refresh the current diff, review bodies, general comments, and live review threads rather than relying on a previous snapshot. A push and remote thread resolution remain separate authorization decisions.

### Review Scope

Check:

- **Mathematical and physical correctness** - units, conversion factors, signs, handedness, coordinate frames, reference systems, apparent or geometric and topocentric or geocentric distinctions, contact geometry, physical quantities, and documented approximation limits.
- **Algorithmic suitability** - objective functions, search windows, adaptive expansion, continuous versus discrete classification, bracketing, endpoint, sample, tangential, and double roots, convergence, degenerate cases, and supported-domain completeness.
- **Numerical robustness** - cancellation, unstable inverse trig, missing clamps, small denominators, tolerance scaling, angle normalization, pole, horizon, or limb behavior, and non-finite output from valid inputs.
- **Implementation correctness** - condition direction, indices, endpoints, stale state, swapped arguments, fallback paths, optional outputs, mutation, initialization, metadata consistency, and cleanup.
- **Performance and memory** - only realistic, material issues under the "Performance and Memory" rules.
- **Async and device lifecycle** - capabilities, resource or command ownership, disconnect and reconnect, cancellation, timeout, late events, session invalidation, and cleanup.
- **Sequencer contracts** - compile and runtime parity, reservation ownership, persisted state transitions, command serialization, retries, artifact durability, terminal ordering, and restart or shutdown behavior.

Examples of reportable domain failures include:

- mixing radians with degrees, AU/day with km/s, or days with seconds;
- applying a geocentric shortcut where topocentric geometry is required;
- confusing center separation with limb contact, or total with annular C2/C3 geometry;
- missing roots because two events lie between coarse samples or because a tangent never changes sign;
- accepting a discrete sampled classification for a property that must hold over a continuous interval;
- using an approximation that materially violates its documented precision or domain;
- propagating `NaN` or `Infinity` from valid inputs into public geometry, time, coordinate, SVG, or image output;
- leaking leases, reservations, operations, timers, listeners, observers, sockets, or in-flight work.

Do not recommend a more sophisticated method merely because it exists. Report it only when the current method fails valid cases, is unstable, or violates a stated precision or performance requirement.

Missing routine input validation is not a finding. Read "Validation Policy" first. An exported helper must work over its documented domain and must not hang, crash, or allocate without bound outside it; that does not require it to reject every invalid argument.

Do not report:

- style, naming, formatting, or test-organization preferences;
- documentation wording unless it causes a public result to be interpreted incorrectly;
- missing or deliberately removed validation outside the two allowed validation cases;
- dependency or API-design preferences without a demonstrated bug;
- speculative alternatives, harmless micro-optimizations, or documented trade-offs;
- pre-existing issues unrelated to the change.

### Reporting Findings

Order findings by severity:

- `P0`: catastrophic correctness failure, data loss, or process-wide failure on a supported path.
- `P1`: likely correctness or lifecycle bug in normal supported use.
- `P2`: edge-case correctness or meaningful numerical robustness issue.
- `P3`: minor robustness issue or material performance or memory issue.

For each finding, provide:

1. severity and a concise title;
2. the exact file, symbol, and smallest useful line location;
3. the failing scenario and code evidence;
4. why it matters physically, mathematically, numerically, or operationally;
5. a concrete fix;
6. the minimal regression test that fails before the fix.

If there are no actionable findings, say so explicitly and mention any verification gap or residual risk. Do not inflate review output with non-findings.

## Git and Commit Workflow

For every completed task that changes tracked files, create a local commit unless the user explicitly says not to commit. Do not create empty commits for review-only or analysis-only tasks.

Before committing:

- Inspect `git status --short`.
- Review the unstaged diff and confirm every changed line is intentional.
- Stage task files explicitly by path; never rely on `git add .` or `git add -A`.
- Inspect `git diff --staged`.
- Commit only after relevant checks pass.
- Follow any user-requested commit granularity, such as one commit per independent review comment.

Authorization boundaries:

- A request to commit does not authorize a push.
- A request to fix review comments does not authorize resolving remote threads.
- Pushes, PR creation or updates, comments, and remote thread resolution each require explicit authorization.
- Never amend, squash, rebase, or rewrite existing commits unless explicitly requested.
- Preserve and leave unstaged all unrelated user changes.

### Commit Messages

Write precise English commit messages with:

1. an imperative subject, normally lowercase, preferably no more than 72 characters and without a trailing period;
2. exactly one blank line;
3. a required body, without break lines, explaining why the change exists and any important side effects, limitations, or trade-offs;
4. exactly one blank line;
5. a `Co-Authored-By: Name <email>` trailer for the authoring agent.

Do not use Conventional Commit prefixes. Avoid vague subjects such as `fix bug`, `update code`, `changes`, `misc`, `cleanup`, `final`, or `wip`. Mention breaking changes explicitly.

Wrap body paragraphs at a readable width and use `-` bullets for several independent effects.

On Windows and across mixed shells:

- Write the complete message to a temporary file outside the repository and commit with `git commit -F <file>`.
- Use the active environment's file-writing mechanism or quoting syntax; never mix PowerShell here-strings with Bash or Bash heredocs with PowerShell.
- Do not pass a multiline message inline with `-m`.
- Remove the temporary file after the commit.
- Read the result back with `git log -1 --format=%B`.
- If quoting corrupts the message, do not amend automatically; report it and let the user decide.

After committing, inspect `git status --short --branch` and report the commit hash, verification performed, skipped checks, and whether remote state was unchanged.
