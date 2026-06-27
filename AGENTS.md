# AGENTS.md

## Overview

This repository is an astronomical application written in TypeScript. It contains a Bun runtime/API and a React web UI for observation planning, device/telescope control, image capture, processing, and visualization.

- Runtime, package manager, builder, and test runner: **Bun**
- Module format: **ESM only**
- UI: **React 19**
- Styling: **Tailwind CSS v4**, compiled by `tailwind.plugin.ts`
- Shared client state/orchestration: **Valtio**, using `src/web/hooks/store.hook.ts`
- Core astronomy, image-processing, and INDI/device library: **nebulosa**

## Repository Layout

- `src/api`: Bun handlers, services, integrations, and route-facing backend code.
- `src/web`: browser entrypoints, UI, stores, hooks, and browser-only helpers.
- `src/web/pages`: HTML and React entrypoints.
- `src/web/ui`: feature-level screens and components.
- `src/web/ui/components`: reusable UI primitives.
- `src/web/stores`: shared browser orchestration and state.
- `src/web/shared`: browser-only API, storage, interpolation, proxy, and utility helpers.
- `src/web/hooks`: React hooks, including store lifecycle management.
- `src/web/assets`: images and icons.
- `src/shared`: cross-layer types, constants, and utilities; keep runtime-neutral where practical.
- `src/data`: assets and data used by runtime and web code.
- `tests`: tests, currently focused on API code.
- `tests/data`: test data and assets.
- `tests/util.ts`: shared test utilities.
- `bin`: build-time data generation.
- `scripts`: maintenance scripts, including codebase graph indexing.
- `tailwind.plugin.ts`: Bun Tailwind CSS v4 build integration.

## Core Principles

- Follow existing repository patterns; do not introduce parallel architectures.
- Make the smallest localized change that fully solves the task.
- Prefer clear, direct code over abstraction-heavy designs.
- Preserve existing behavior unless the task explicitly changes it.
- Deliver production-ready code: no TODOs, placeholders, or unfinished branches.
- Avoid new dependencies unless their startup, bundle, binary-size, and operational costs are justified.
- Keep comments limited to non-obvious logic, normalization, lifecycle cleanup, or interaction behavior.
- Do not add accessibility- or ARIA-specific work unless explicitly requested.
- Never add or expand HeroUI. Treat it as legacy; use React, Tailwind CSS, Tailwind Variants, and existing local primitives.
- Use `Icons` from `src/web/ui/Icon.tsx` and `IconButton` for icon-only actions. Do not add an icon dependency without an explicit requirement.

## Code Discovery

Prefer `codebase-memory-mcp` graph tools when the repository is indexed.

1. Search exact symbols with `search_graph(name_pattern=...)`.
2. Inspect results with `get_code_snippet(...)`.
3. Use scoped `search_code(...)`, such as `^src/web/`, `^src/api/`, or `^src/shared/`.
4. Use shell search only for non-code files, string literals, or insufficient graph results.

Additional repository-specific guidance:

- Components declared as `const Component = memo(() => ...)` may appear as `Variable` nodes. Treat them as valid component results.
- `trace_path(mode='calls')` is incomplete for JSX render relationships; verify rendered usage with `search_code(...)`.
- After major route, file, or symbol changes, run `bun run index` when graph results may be stale.

## Commands

- Install dependencies: `bun install`
- Development server: `bun dev`
- Production mode: `bun prod`
- Build executable: `bun run compile`
- Format: `bun run fmt`
- Format check: `bun run fmt:check`
- Lint and type-check: `bun run lint`
- Lint with fixes: `bun run lint:fix`
- Refresh codebase graph: `bun run index`
- Test: `bun test`

Do not introduce `npm`, `yarn`, `pnpm`, Vite, PostCSS, another test runner, or another bundling layer. Do not use `bun run compile` as a substitute for linting.

## Architecture and Placement

### Runtime and API

- `main.ts` owns startup, CLI/environment parsing, handler wiring, and `Bun.serve`.
- Keep `main.ts` small. Extract reusable or domain logic into `src/api` or `src/shared`.
- Put Bun-only code in the root runtime or `src/api`.
- Filesystem, process, device-control, and server-listener side effects belong in `main.ts` or `src/api`, never in presentational React components.
- Parse and normalize CLI arguments and `Bun.env` near startup; pass typed configuration inward instead of reading environment variables throughout the codebase.
- Keep startup fast: statically import bootstrap-critical code, lazy-load infrequent/heavy functionality, and avoid large synchronous setup.
- Prefer Bun APIs for runtime work: `Bun.file`, `Bun.write`, `Bun.spawn`, and `Bun.serve`.
- Avoid Node-only tooling or packages unless Bun compatibility is confirmed.
- Keep Tailwind integration in `tailwind.plugin.ts`.

### HTTP APIs

- Follow the existing `class XHandler` plus `function x(handler): Endpoints` pattern.
- Use `query()` and `response()` from `src/api/http.ts` for request parsing and JSON responses.
- Register endpoint maps by spreading them into `routes` in `main.ts`; do not inline unrelated route logic there.
- Reuse `WebSocketMessageHandler` for server-to-browser fanout. Do not add parallel socket registries.
- Validate and normalize untrusted request data once at the boundary, then pass typed values inward.
- Keep transport DTOs as small plain objects. Use richer internal types only where needed, converting once at the edge.
- Use discriminated `Result`-style unions for expected failures rather than exceptions for routine control flow.
- Keep large payload paths streaming-friendly; do not force full materialization or deep clones unnecessarily.

### Shared and Browser Code

- Keep cross-layer contracts and domain models in `src/shared` when both runtime and web code use them.
- Avoid Bun-only or browser-only imports in `src/shared` unless unavoidable.
- Put browser HTTP access in `src/web/shared/api.ts`.
- Keep WebSocket lifecycle in `src/web/stores/ws.store.ts`.
- Use `src/shared/bus` for cross-feature browser events instead of introducing another transport or event layer.
- Move CPU-heavy or IO-heavy work out of React render paths into async boundaries, workers, or `src/api`.

### UI Placement

- Put reusable visual primitives in `src/web/ui/components`.
- Put feature-specific screens and composites in `src/web/ui`.
- Keep page entrypoints, feature composition, providers, hooks, and browser wiring in `src/web`.
- Put browser-only adapters and utilities in `src/web/shared`.
- Do not place generic reusable components inside feature folders.

## TypeScript

- Use TypeScript for new code. Add `.js` only for unavoidable external/tool constraints.
- Use ESM syntax only; never introduce `require`, `module.exports`, or CommonJS.
- Keep strict typing. Do not bypass errors with `any` or unsafe assertions.
- Prefer `unknown`, generics, discriminated unions, and narrow helpers over `any`.
- Prefer `type` over `interface`, except when declaration merging or class implementation behavior is required.
- Prefer inference for local values; write explicit types for exported APIs, public hooks, store contracts, and complex returns.
- Match existing imports: omit `.ts`/`.tsx`; use `src/*` for runtime/shared imports, `@/*` for web-only aliases, and relative paths for close siblings.
- Use `import type` and `export type` for type-only traffic.
- Avoid barrel files and broad `export *` surfaces, especially in hot or shared modules.
- Use `satisfies` for shape validation without losing inference and `as const` for literal configuration, actions, and tuple-like values.
- Model state machines and command/result flows with discriminated unions and exhaustive `switch` statements.
- Do not encode invalid states through loosely optional fields when a union or separate type is clearer.
- Keep exported utility types and generic signatures shallow, small, and readable.
- Prefer stable explicit object shapes over broad index signatures or catch-all records in hot paths.
- Prefer primitives and explicit serialized forms at API boundaries, such as numeric timestamps over `Date`, unless a richer type has a measured benefit.
- Validate every untrusted boundary: network, filesystem, environment, process input, and third-party APIs.
- Await promises, or explicitly mark intentional fire-and-forget work with `void` and error handling.
- Throw only `Error` instances. Normalize unknown failures at logging, API, and rethrow boundaries.
- Use `performance.now()` for durations and profiling. Use `Date` only for wall-clock timestamps.

## React and UI

### React

- Use function components and hooks only.
- Use `.tsx` only in files that render JSX; keep hooks, stores, adapters, and non-visual logic in `.ts`.
- Keep render functions pure. Do not mirror props into state or derive state through effects.
- Prefer local state. Lift it only when siblings or features genuinely share it.
- Preserve the declaration style of files you touch:
    - shared primitives commonly use named functions and React 19 `ref` props;
    - feature modules commonly use `const Component = memo(() => ...)`.
- Do not use `forwardRef`; React 19 supports `ref` as a normal prop.
- Use `startTransition`, `useDeferredValue`, and `useEffectEvent` only when they solve a demonstrated responsiveness or stale-closure problem.
- Do not add `useMemo` or `useCallback` by default. Use them only for measured hot paths or APIs that require stable references.
- Use stable data-derived keys. Never generate keys during render.
- Clean up timers, subscriptions, observers, and interruptible async work in effects; prefer `AbortController` where applicable.
- Split large screens into feature sections and leaf components that subscribe only to the state they render.
- Lazy-load optional or heavy UI with `React.lazy` and Suspense.
- Virtualize large lists/tables and defer expensive maps, charts, and visualizations until visible or requested.
- Keep context narrow. Do not build broad rerender-prone global contexts when local state or Valtio is sufficient.

### Tailwind CSS

- Use Tailwind CSS v4 in CSS-first mode.
- Prefer `@theme` and CSS variables for tokens.
- Keep Tailwind classes statically discoverable. Map state to complete class strings; do not construct partial utility names dynamically.
- Keep classes readable and mostly static.
- Use `clsx`, `tailwind-merge`, and `tailwind-variants` only where composition actually benefits from them.
- Avoid arbitrary values unless they represent a real token or measured one-off layout requirement.
- Use transform and opacity for animation; avoid layout- and paint-heavy animation where possible.
- Keep custom CSS for tokens, rare layout exceptions, and complex keyframes that utilities cannot express cleanly.
- Do not add a Tailwind config unless necessary; prefer v4 patterns over legacy JavaScript configuration.

### Reusable Components

Before adding a component, start with the closest existing primitive:

- Actions: `Button`, `IconButton`, `ButtonGroup`, `ToggleButton`
- Fields: `TextInput`, `NumberInput`, `DateTimeInput`, `SearchTextInput`
- Selection/lists: `List`, `Table`, `Select`, `MultiSelect`, `FilterableList`, `FilterableSelect`, `Dropdown`, `Tabs`
- Overlays: `Floating`, `Popover`, `Tooltip`
- Display/status: `Badge`, `Breadcrumbs`, `Calendar`, `Chip`, `Histogram`, `ProgressBar`, `Toast`

Rules:

- Build a new primitive only when existing components cannot satisfy the product need.
- Keep primitives generic and composable; keep domain-specific UI outside the base component layer.
- Use one file in `src/web/ui/components` for a new shared primitive.
- Define the component purpose, required/optional props, variants, sizes, state mode (controlled/uncontrolled), and ref support before implementation.
- Start with the appropriate native element. Add wrappers only when required for layout, slots, validation text, icons, descriptions, or loading indicators.
- Use a local `tv()` definition for reusable styling. Use slots for multipart controls and `VariantProps<typeof ...>` for variant typing.
- Keep `base` styles universal, variants semantic, and combined styling in `compoundVariants`.
- Do not use large nested JSX ternaries to construct class names.
- Keep APIs predictable: use `variant`, `color`, and `size` where the existing component family uses them.
- Reuse semantic values where applicable:
    - presentation: `solid`, `outline`, `ghost`, `flat`
    - intent: `default`, `primary`, `secondary`, `success`, `danger`, `warning`
    - size: `sm`, `md`, `lg`
- For semantic colors, prefer a local CSS variable such as `[--color-variant:var(--primary)]` rather than duplicating palettes.
- Match existing geometry: `rounded-lg` default surfaces and the established Button/Input height scale unless the component has a clear reason to differ.
- Use neutral dark surfaces (`bg-neutral-900/70` to `bg-neutral-800`) as the default; reserve accent colors for action, selection, and emphasis.
- Expose `className` for one-surface components and typed `classNames` for multipart components. Merge overrides through `tw()` from `src/web/shared/util.ts` or `clsx` plus `tailwind-merge`.
- Support existing standard state props such as `fullWidth`, `disabled`, `readOnly`, and `loading` when relevant.
- Style disabled, read-only, and loading states internally; do not require callers to build alternate layouts.
- Use `startContent`, `endContent`, `label`, or slots for adornments rather than wrapper elements at each call site.
- Preserve existing focus treatment unless there is a specific product reason to diverge.
- For icon-only actions, use `IconButton`; for inline adornments, use `startContent`/`endContent`.
- Flatten fragments in children-consuming compound components, following existing `ButtonGroup`, `Breadcrumbs`, `Tabs`, and `Table`.
- For large rows/options, prefer `itemCount` plus a renderer function like `List` and `Table`; do not allocate sliced child arrays.

## Stores and Valtio

- Use the lifecycle pattern from `src/web/hooks/store.hook.ts`.
- Do not reintroduce Bunshi, molecule APIs, scopes, generic provider abstractions, or a parallel store framework.
- Use one proxy store per feature/domain, not a monolithic global store.
- Keep transient UI state local unless it is shared across features.
- Export mutations/actions from store modules; do not scatter shared-state updates through components.
- Subscribe as low as possible with `useSnapshot`. Read only fields rendered by the component and avoid passing full snapshots deep through the tree.
- Keep expensive derived values out of hot render paths.
- Avoid broadly observed proxies for heavy, non-serializable, or constantly changing values; prefer refs or specialized modules.

### Store Conventions

- Store files end in `.store.ts`.
- Name singleton orchestrators `featureStore`; name factory functions `featureStore(...)`.
- Singleton stores keep long-lived state at module scope, define actions locally, and export `{ state, ...actions } as const`.
- Factory stores create `proxy(...)` inside the factory, export `type FeatureStore = ReturnType<typeof featureStore>`, and return `{ state, mount, unmount, ...actions } as const`.
- Instantiate factory stores with `useStore(() => featureStore(args), deps)`.
- Use `useStore(featureStore, [])` for singleton stores when mount/unmount handling is required.
- Keep dependencies minimal and stable; include only values that should recreate the store instance.
- Use explicit contexts from `src/web/shared/context.ts` only when a subtree must share a specific device or store instance.
- Use `mount` for subscriptions, timers, browser lifecycle, and persisted proxy wiring. Make it idempotent when repeat calls are possible.
- Always provide idempotent `unmount` cleanup when resources are acquired. Store unsubscribe callbacks in `VoidFunction[]` and clean them with `unsubscribe(...)` from `src/shared/util`.
- Persist reload-surviving browser state through `initProxy`, `fillProxy`, `subscribeProxy`, `storageGet`, or `storageSet`; do not use ad hoc `localStorage` calls inside UI.
- Treat `initProxy` as hydration plus subscription setup. Retain its cleanup for scoped/factory stores; use module scope only for intentional app-lifetime stores.
- Use `p:key` for primitive persisted fields and `o:key` for object/nested proxy fields.

## Testing

- Use `bun:test` and `bun test`; keep new test tooling Bun-compatible.
- Write the smallest deterministic test that proves behavior at the correct boundary.
- Prefer focused unit tests for pure logic and targeted integration tests for framework or IO boundaries.
- Keep tests near the code they verify unless a shared integration harness is clearly better.
- Keep fixtures small, explicit, and local unless reuse improves readability.
- Mock only true external boundaries: network, filesystem, time, process, and third-party services.
- Do not mock inexpensive internal call paths merely to isolate them.
- Avoid snapshot-heavy tests. Assert precise behavior, contracts, and user-visible results.
- Do not add UI tests or a UI test stack. Record a relevant UI coverage gap in final notes when applicable.

### API Tests

- Prefer integration-style tests around handlers, services, serializers, and adapters.
- Instantiate/call handlers directly before booting the whole server when that lower-level seam proves the behavior.
- Cover success and typed failure paths, including malformed input, validation errors, missing configuration, timeouts, and upstream failures.
- Assert status/result shape, headers, serialized fields, error payloads, and normalization behavior.
- Use realistic invalid inputs, not only well-typed fixtures.
- Use temporary files, isolated directories, and isolated in-memory state for IO tests. Clean up resources and child processes.
- Stub only expensive or nondeterministic boundaries; keep tests fast.

## Performance

- Optimize for fast startup, small bundles, and low rerender frequency.
- Prefer direct code over abstraction-heavy layers that increase indirection or bundle size.
- Code-split optional and large feature modules.
- Defer non-critical work until after first meaningful paint or user intent.
- Avoid effect chains that cause cascaded renders.
- Keep props small and stable at component boundaries.
- Move expensive computations off render paths and off the main thread when they can block interaction.
- Before adding a library, verify that Bun, React, Tailwind, Valtio, or existing local primitives do not already solve the problem.

## Quality Gates

- Keep TypeScript strict and modules focused with clear ownership.
- Follow OXC for formatting and linting. Do not add Prettier or ESLint.
- Respect current OXC guardrails: avoid import cycles and floating promises; use `performance.now()` for durations.
- Run the smallest relevant checks before finishing:
    - `git diff --check`
    - `bun run fmt:check` or the relevant `oxfmt` check
    - `bun run lint` or the relevant `oxlint` check
    - `bun test` for relevant behavior
    - `bun run compile` when changing Bun runtime, environment, packaging, or build-plugin code
- Preserve Bun-first workflows in every change.

## Commit Messages

Commit messages must be precise, English, and easy to scan.

- Use lowercase except for acronyms, proper nouns, package names, and file names.
- Begin directly with a present-tense imperative verb, such as `implement`, `fix`, `improve`, `update`, `use`, `remove`, `rename`, or `refactor`.
- Do not use Conventional Commit prefixes such as `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, or scopes.
- Keep the subject concise and specific, ideally 72 characters or fewer, and do not end it with a period.
- Describe the technical or user-visible effect, not implementation noise or effort.
- Keep one logical change per commit.
- Avoid vague subjects such as `fix bug`, `update code`, `changes`, `misc`, `cleanup`, `final`, or `wip`.
- Add a body when rationale, trade-offs, migration steps, behavior changes, limitations, or follow-up work are not obvious.
- Reference issues/tasks when applicable and state breaking changes explicitly.

## Completion Checklist

Before finalizing a change, verify:

- Code is in the correct layer and follows existing patterns.
- New dependencies are Bun-compatible and justified.
- UI reuses existing primitives, Tailwind tokens, and component conventions before adding new CSS or widgets.
- State belongs in Valtio, local React state, or nowhere; it is not global by default.
- The change does not introduce avoidable startup, binary-size, bundle-size, or rerender costs.
- The implementation is the simplest correct solution.
- Types, imports, compilation, relevant behavior, state usage, and rendering behavior are correct.
- The result is complete and production-ready.
