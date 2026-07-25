# AGENTS.md

## Project

This repository is a TypeScript astronomy application with a Bun runtime/API and a React web UI for planning, device control, image capture, processing, and visualization.

- Runtime, package manager, builder, and test runner: **Bun**
- Modules: **ESM only**
- UI: **React 19**
- Styling: **Tailwind CSS v4** through `tailwind.plugin.ts`
- Browser state and orchestration: **Valtio** through `src/web/hooks/store.hook.ts`
- Astronomy, imaging, and INDI/device functionality: **nebulosa**

## Source Map

- `main.ts`: startup, CLI/environment normalization, dependency wiring, routes, WebSocket setup, and `Bun.serve`.
- `build.ts` and `tailwind.plugin.ts`: production build and Tailwind integration.
- `src/api`: Bun-only handlers, services, integrations, and endpoint maps.
- `src/types`: domain and transport contracts shared by runtime and web code.
- `src/shared`: small runtime-neutral helpers and bus infrastructure.
- `src/lib`: internal domain libraries that do not belong to a UI feature.
- `src/web/pages`: HTML and React browser entrypoints.
- `src/web/ui`: feature screens and composites.
- `src/web/ui/components`: reusable UI primitives.
- `src/web/stores`: Valtio feature stores and browser orchestration.
- `src/web/hooks`: React hooks, including store lifecycle management.
- `src/web/shared`: browser API, bus adapters, contexts, persistence, proxy, and utility helpers.
- `src/web/assets` and `src/data`: static assets and runtime data.
- `tests`: Bun tests; mirror the source boundary being tested.
- `bin` and `scripts`: data generation and maintenance, including graph indexing.

## Working Principles

- Inspect the live code and nearby patterns before editing. Preserve existing behavior unless the task changes it explicitly.
- Make the smallest cohesive change that fully solves the task. Do not introduce parallel architectures, compatibility wrappers, or speculative abstractions.
- Deliver finished production code: no TODOs, placeholders, debug artifacts, or unfinished branches.
- Preserve unrelated worktree changes. Review and stage only files belonging to the current task.
- Avoid new dependencies unless existing Bun, React, Tailwind, Valtio, or local primitives cannot solve the problem and the startup, bundle, binary, and operational costs are justified.
- Keep comments for non-obvious behavior, normalization, lifecycle cleanup, or interaction details.
- Do not add accessibility- or ARIA-specific work unless requested.
- Never add or expand HeroUI. It is legacy.

## Discovery

Prefer the indexed `codebase-memory-mcp` graph for code discovery:

1. `search_graph` for symbols.
2. `trace_path` for callers, callees, and data flow.
3. `get_code_snippet` after finding the exact qualified name.
4. `search_code` for scoped code text or JSX usage.
5. `query_graph` and `get_architecture` for broader structural questions.

Use `rg` for string literals, error messages, configuration, documentation, and cases the graph cannot answer. JSX render relationships may require `search_code`. Re-run `bun run index` after major file, route, or symbol changes.

## Commands

- Install: `bun install`
- Development: `bun dev`
- Production: `bun prod`
- Compile executable: `bun run compile`
- Format / check: `bun run fmt`, `bun run fmt:check`
- Lint and type-check / fix: `bun run lint`, `bun run lint:fix`
- Test: `bun test`
- Refresh graph: `bun run index`

Do not introduce npm, Yarn, pnpm, Vite, PostCSS, Prettier, ESLint, another test runner, or another bundling layer. `bun run compile` does not replace linting.

## Architecture

### Runtime and API

- Keep `main.ts` focused on startup and wiring. Put reusable domain logic in `src/api`, `src/lib`, or `src/shared`.
- Keep filesystem, process, device, listener, and other Bun-only side effects out of browser and presentational code.
- Parse and validate CLI arguments and `Bun.env` near startup, then pass typed configuration inward.
- Prefer Bun APIs such as `Bun.file`, `Bun.write`, `Bun.spawn`, and `Bun.serve`; confirm Bun compatibility before using Node-specific packages or APIs.
- Follow the existing `class XHandler` plus `function x(handler)` endpoint-map pattern. Return route objects with `as const satisfies Endpoints` and spread them into `routes` in `main.ts`.
- Use `query()` and `response()` from `src/api/http.ts`. Validate untrusted input once at the boundary and keep transport DTOs small and plain.
- Model expected failures with discriminated result unions instead of exceptions used as routine control flow.
- Reuse `WebSocketMessageHandler` for server-to-browser fanout; do not create another socket registry.
- Keep large payload paths streaming-friendly and avoid unnecessary materialization or deep cloning.

### Shared and Browser Boundaries

- Put contracts used by both runtime and browser in `src/types`; keep them free of Bun-only and browser-only imports.
- Keep `src/shared` runtime-neutral. Put browser HTTP access, persistence, proxy helpers, and adapters in `src/web/shared`.
- Keep browser WebSocket lifecycle in `src/web/stores/ws.store.ts`.
- Use the existing bus modules for cross-feature events instead of adding another event or transport layer.
- Move CPU-heavy or IO-heavy work out of React render paths into async boundaries, workers, or `src/api`.

## TypeScript and Formatting

- Use TypeScript and ESM. Never add CommonJS.
- Follow OXC formatting: tabs, single quotes, no semicolons, configured line width, sorted imports, and Tailwind class sorting. Preserve intentional `// oxfmt-ignore` directives.
- Keep strict types. Do not suppress errors with `any`, unchecked assertions, or broad index signatures when `unknown`, generics, narrowing, or explicit shapes work.
- Type parameters. Prefer inferred locals and explicit exported APIs, public hooks, store contracts, and complex returns.
- Use interfaces for object contracts and types for unions, tuples, mapped types, and aliases. Use readonly tuple aliases for vectors and matrices.
- Prefer `undefined` for absence. Use `null` only when it has a distinct semantic meaning or an external contract requires it.
- Prefer camel-case string-literal unions over enums for finite internal states. Use discriminated unions and exhaustive switches for state machines and command/result flows.
- Use `import type`, `export type`, `satisfies`, and `as const` where they preserve intent and inference.
- Avoid barrel files and broad `export *` surfaces.
- Follow nearby imports and configured aliases: `src/*` for root source, `#/*` for `src/types`, web aliases such as `@/*`, `@ui/*`, `@stores/*`, `@shared/*`, `@hooks/*`, and relative paths for close siblings.
- Validate network, filesystem, environment, process, and third-party input at their boundaries.
- Await promises or mark intentional fire-and-forget work with `void` and error handling. Throw only `Error` instances and normalize unknown failures at logging/API boundaries.
- Use `performance.now()` for durations and `Date` for wall-clock timestamps.

## React and UI

### Components

- Use function components and hooks. Use `.tsx` only when the file renders JSX.
- Keep renders pure; do not mirror props into state or derive state through effects.
- Prefer local state and narrow props. Subscribe with `useSnapshot` as low as practical and read only the fields being rendered.
- Preserve the declaration style of the file: shared primitives commonly use named functions and feature components commonly use `const Component = memo(...)`.
- React 19 accepts `ref` as a normal prop; do not introduce `forwardRef`.
- Do not add `useMemo` or `useCallback` by default. Use them only for measured hot paths or APIs requiring stable references.
- Use stable data-derived keys. Clean up timers, subscriptions, observers, and interruptible async work; prefer `AbortController` when applicable.
- Use `startTransition`, `useDeferredValue`, `useEffectEvent`, lazy loading, Suspense, or virtualization only for a demonstrated interaction, stale-closure, bundle, or rendering problem.

### Reusable UI and Tailwind

- Start with the closest primitive in `src/web/ui/components`. Keep feature-specific composites in `src/web/ui`.
- Use `Icons` from `src/web/ui/Icon.tsx` and `IconButton` for icon-only actions. Do not add an icon library without an explicit requirement.
- Add a primitive only when existing ones cannot express the product need. Keep it generic, controlled where practical, ref-capable, and in one file under `src/web/ui/components`.
- Match existing APIs and semantic variants (`variant`, `color`, `size`, `disabled`, `readOnly`, `loading`, `fullWidth`, `startContent`, `endContent`). Style supported states inside the primitive.
- Use local `tv()` definitions, typed slots/class overrides, and `tw()` from `src/web/shared/util.ts` where composition benefits from them.
- Keep Tailwind classes statically discoverable. Prefer CSS variables and `@theme` tokens; avoid dynamic partial utility names and arbitrary values without a measured reason.
- Preserve established geometry and focus treatment. Use neutral dark surfaces by default and accents for action, selection, or emphasis.
- Flatten fragments in compound child APIs. For large collections, prefer `itemCount` plus a renderer, following `List` and `Table`.

## Stores and Valtio

- Follow `src/web/hooks/store.hook.ts`; do not reintroduce Bunshi, molecule APIs, generic providers, or another store framework.
- Use one store per feature/domain. Keep transient UI state local and export specialized, concretely typed actions instead of a generic indexed `update` API.
- Singleton stores keep long-lived state at module scope and export `{ state, ...actions } as const`.
- Factory stores create `proxy(...)` inside `featureStore(...)`, export `type FeatureStore = ReturnType<typeof featureStore>`, and return `{ state, mount, unmount, ...actions } as const`.
- Instantiate factories with `useStore(() => featureStore(args), deps)`. Use `useStore(featureStore, [])` for lifecycle-aware singletons. Keep dependencies minimal and stable.
- Acquire subscriptions, timers, browser lifecycle hooks, and persistence in idempotent `mount`; release them in idempotent `unmount`. Collect cleanup functions and use `unsubscribe(...)` from `src/shared/util`.
- Use explicit contexts from `src/web/shared/context.ts` only when a subtree must share a particular store or device instance.
- Persist reload-surviving state through `initProxy`, `fillProxy`, `subscribeProxy`, `storageGet`, or `storageSet`; retain cleanup for scoped stores. Use `p:key` for primitive fields and `o:key` for object/proxy fields.

## Testing and Validation

- Use `bun:test`; place tests under `tests` according to the boundary they verify.
- Write the smallest deterministic test that proves behavior at the appropriate unit or integration seam.
- Prefer focused tests for pure logic and integration-style tests for handlers, services, serializers, adapters, and IO boundaries.
- Mock only true external or nondeterministic boundaries. Keep fixtures small, explicit, isolated, and cleaned up.
- Cover success and typed failure paths, including malformed input, validation errors, missing configuration, timeouts, and upstream failures where relevant.
- Assert behavior and contracts precisely; avoid snapshot-heavy tests.
- Do not add a browser/UI test stack. Mention a relevant UI coverage gap in the handoff when applicable.

Run the smallest relevant gates before finishing:

1. Focused `bun test` for changed behavior.
2. `bun run fmt:check` for touched files.
3. `bun run lint` for TypeScript changes.
4. `bun run compile` for runtime startup, environment, packaging, build, or Tailwind-plugin changes.
5. `git diff --check`.

Report commands that could not run and why. Do not commit while relevant errors remain.

## Commits and Handoff

- Unless the user explicitly says not to commit, create a commit for the completed task.
- Inspect `git status --short` and the final diff. Stage explicit reviewed paths only, then inspect `git diff --staged`.
- Keep each commit to one logical change. Do not include unrelated edits, generated files, debug output, or local configuration.
- Do not amend, squash, rebase, or rewrite existing commits unless requested.
- Use a concise English imperative subject, normally at most 72 characters, with no Conventional Commit prefix or final period. Lowercase except for acronyms, proper nouns, packages, and filenames.
- A body is required. Explain why the change exists and any important behavior, side effects, trade-offs, limitations, or breaking changes.
- End with a `Co-Authored-By` trailer identifying the agent. Separate subject, body, and trailers with exactly one blank line:

```text
<imperative subject>

<required explanatory body>

Co-Authored-By: <name> <email>
```
