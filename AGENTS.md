# AGENTS.md

## Overview

This repository contains both the Bun runtime/API and the React frontend for astronomical software written in TypeScript. It includes observation planning, telescope/device control, and image capture, processing, and visualization features.

This project uses **Bun** as runtime, package manager, builder, and test runner, ESM modules only.

This project uses **React** for the web UI.

This project uses **Tailwind CSS v4** for styling.

This project uses **Valtio** and **Bunshi** for shared client-side state and orchestration.

## Project Structure

* `src`: Application source files.
* `src/api`: Bun runtime handlers, services, and route-facing backend code.
* `src/web`: Browser entrypoints, UI, molecules, hooks, and web-only helpers.
* `src/web/pages`: HTML + React entrypoints. Currently only the `home` page exists.
* `src/web/ui`: Feature and screen-level React components.
* `src/web/ui/components`: Reusable UI primitives.
* `src/web/molecules`: Bunshi molecules and shared client orchestration/state.
* `src/web/shared`: Browser-side helpers for API calls, storage, interpolation, proxying, and related utilities.
* `src/web/hooks`: React hooks.
* `src/web/assets`: Images and icons.
* `src/shared`: Types and utilities shared between runtime and web. Keep it runtime-agnostic where practical.
* `tests`: Currently API-focused tests.
* `data`: Data/assets used by `tests`, `api`, and `web`.
* `bin`: Build-time data generation scripts.

## General Rules

* Follow existing patterns in the repository. Do not invent new ones.
* Make minimal, localized changes.
* Prefer clarity over abstraction.
* Deliver complete, production-ready code (no TODOs, no placeholders).
* Do not break existing behavior unless explicitly required.
* Never add or expand HeroUI usage. Treat HeroUI as legacy code scheduled for removal; build new UI with React, Tailwind CSS, Tailwind Variants, and existing non-HeroUI primitives instead.
* Do not add accessibility or ARIA work in this project unless explicitly requested. This is a personal project, so accessibility-specific enhancements are out of scope by default.
* Always add single-line comments to methods, functions, and relevant lines of code.

## Repo Discovery

- Prefer `codebase-memory-mcp` graph tools first for code discovery when the repo is indexed.
- Use shell search only for non-code files, string literals, or when graph results are insufficient.
- For this repo, prefer `search_graph(name_pattern=...)` over BM25 text queries when looking for React components by exact name.
- In this codebase, React components exported as `const Component = memo(() => ...)` are often indexed as `Variable` nodes instead of `Function` nodes.
- `get_code_snippet` still works for those component variables once you have the qualified name, so treat `Variable` results as valid component hits.
- `trace_path(mode='calls')` is currently weak for JSX render relationships in this repo. Do not rely on it alone to answer which component renders another.
- `trace_path` can also miss or partially represent JSX-based component usage inside returned markup, fragments, and compound component APIs.
- Recommended discovery order for React/UI work in this repo is `search_graph(name_pattern='.*ExactComponentName.*')`, then `get_code_snippet(...)`, then `search_code(...)` scoped to `^src/web/` (or `^src/api/` / `^src/shared/` when appropriate), and only then shell search.

## Default Commands

- Install dependencies: `bun install`
- Start development: `bun dev`
- Start production mode: `bun prod`
- Build executable: `bun run compile`
- Lint with fixes: `bun run lint`
- Format: `bun run format`
- Type-check: `bun run tsc`
- If tests are added, prefer `bun test` before introducing another test runner.

## Architecture Rules

- `main.ts` currently owns startup, CLI/env parsing, handler wiring, and `Bun.serve`. Prefer extracting reusable or domain logic into `src/api` or `src/shared` instead of growing inline blocks further.
- Put Bun-only code in the root runtime or `src/api`.
- When adding HTTP endpoints, follow the existing `class XHandler` plus `function x(handler): Endpoints` module pattern in `src/api`, then register the returned route map in `main.ts`.
- Put reusable visual components in `src/web/ui/components`, not in app feature files.
- Put browser-side orchestration and shared client state in `src/web/molecules`.
- Keep `src/shared` reusable across runtime and web when practical. Avoid browser-only or Bun-only runtime imports there unless the shared contract genuinely requires them.
- Keep browser-side HTTP, WebSocket, and storage access in `src/web/shared` or `src/web/molecules`, not scattered across leaf UI components.
- Keep browser fetch logic in `src/web/shared/api.ts`, browser WebSocket lifecycle in `src/web/molecules/ws.ts`, and reuse `src/shared/bus` for cross-feature browser events instead of creating parallel transport layers.
- Filesystem, process, device-control, and server-listener side effects belong in `main.ts` or `src/api`, not presentational React components.
- Move CPU-heavy and IO-heavy work out of React render paths and into async boundaries, workers, or `src/api`.
- Do not introduce `npm`, `yarn`, or `pnpm` workflows into this repository.

## Bun Rules

- Prefer Bun-native APIs when runtime code is needed: `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.serve`.
- Keep all new code compatible with Bun's ESM-oriented toolchain and the existing `bun run compile` build.
- Avoid Node-only tooling or packages unless Bun compatibility is confirmed.
- Follow the current runtime configuration pattern in `main.ts`: parse CLI args and `Bun.env` near startup, normalize eagerly, and pass typed config inward instead of reading env ad hoc throughout the app.
- Keep startup fast by statically importing core bootstrap code, lazy-loading infrequent or heavy features, and avoiding large synchronous setup in `main.ts`.
- Do not add runtime transpilers, redundant CLIs, or duplicate bundling layers.
- Any new dependency must justify its cost in startup time, binary size, or operational complexity.

## API Rules

- Model feature APIs the same way existing modules do: keep long-lived behavior in handler classes and expose routes through a separate factory that returns `Endpoints`.
- Reuse `query()` and `response()` from `src/api/http.ts` for route parsing and JSON responses instead of reimplementing small wrappers per file.
- Register new endpoint maps by spreading them into the `routes` object in `main.ts`, not by inlining unrelated route logic there.
- Reuse `WebSocketMessageHandler` for server-to-browser fanout instead of creating additional socket registries.

## TypeScript Rules

- Prefer TypeScript for all new code. Do not introduce new `.js` files unless a tool or external constraint requires it.
- Use ESM syntax only. Do not introduce `require`, `module.exports`, or other CommonJS patterns.
- Keep TypeScript strict and work with the type system instead of routing around it.
- Prefer inference for local values, but add explicit types for exported APIs, public hooks, store contracts, and complex function returns.
- Avoid `any`. Use `unknown`, generics, discriminated unions, or narrow helper functions instead.
- Prefer `type` over `interface` unless declaration merging or class implementation behavior is specifically needed.
- Match the repository's current import style: omit `.ts` and `.tsx` extensions in authored imports.
- Prefer `src/*` imports from runtime/shared code, `@/*` imports for web-only aliases, and relative imports for nearby siblings in the same feature folder.
- Avoid barrel files and broad `export *` surfaces by default, especially in hot paths or shared packages where they can obscure ownership and encourage import cycles.
- Use `satisfies` to validate object shapes without weakening inference.
- Use `as const` for literal config, action names, and tuple-like values that should stay narrow.
- Prefer discriminated unions and exhaustive `switch` statements for state machines, async status, and command/result flows.
- Keep shared domain models and cross-layer contracts in `src/shared` when both runtime and web consume them.
- Validate untrusted input at runtime at every boundary: network, filesystem, environment variables, Bun process input, and third-party APIs.
- For API code, validate and normalize payloads once at the boundary, then pass strongly typed data inward without repeated parsing, cloning, or shape rewriting.
- Model API request and response bodies as small plain-object DTOs. Avoid class-based transport models, decorators, reflection, and other patterns that add runtime cost.
- Prefer stable, explicit object shapes over wide index signatures and catch-all records in hot API paths. Narrower types usually lead to fewer checks and less defensive code.
- Use discriminated `Result`-style unions for expected API failures instead of exception-driven control flow.
- Separate transport DTOs from richer internal types when serialization, normalization, or caching needs differ. Convert once at the edge, not throughout the call chain.
- Keep large payload paths streaming-friendly. Do not type APIs in a way that forces materializing large arrays, strings, or deeply cloned objects when iteration or chunking is enough.
- Keep utility types shallow in exported APIs. Avoid deeply recursive conditional or mapped types that slow type-checking and make hot modules harder to maintain.
- Prefer primitives and explicit serialized forms at API boundaries, such as numeric timestamp over `Date` objects, unless a richer runtime type is measurably necessary.
- Await promises or intentionally mark fire-and-forget work with `void` plus explicit error handling. Do not leave floating promises in request, effect, or startup paths.
- Throw `Error` instances only. Normalize unknown failures at boundaries before logging, returning, or rethrowing them.
- Use `performance.now()` for duration measurement and profiling. Use `Date` only when a real wall-clock timestamp is required.
- Use `import type` and `export type` for type-only traffic to keep modules explicit and reduce accidental runtime coupling.
- Do not hide invalid states behind optional fields when a union or separate type is clearer.
- Keep generics small and readable. If a generic signature is hard to explain, simplify the API before adding more type machinery.

## React Rules

- Use function components and hooks only.
- Use `.tsx` only for files that render JSX. Keep hooks, stores, adapters, and other non-visual logic in `.ts` files.
- Prefer local state first. Lift state only when multiple siblings or features truly share it.
- Keep renders pure. Do not mirror props into state or create effect-driven derived state.
- Preserve local component style in touched files. Many UI modules export `const Component = memo(() => ...)`; extend that pattern within the file instead of mixing declaration styles without a reason.
- Use `startTransition`, `useDeferredValue`, and `useEffectEvent` when they solve a real responsiveness or stale-closure problem.
- Do not add `useMemo` or `useCallback` by default. Use them only for measured hot paths or third-party API boundaries that require stable references.
- Use stable keys derived from data. Do not generate keys during render.
- Clean up timers, subscriptions, observers, and async work in effects. Prefer `AbortController` or equivalent cancellation for interruptible async flows.
- Split large screens into feature sections and small leaf components that subscribe only to the state they render.
- Use `React.lazy` and Suspense for heavy or optional UI.
- Virtualize long lists and large tables.
- Defer expensive charts, maps, and other heavy visualizations until visible or requested.
- Keep context usage narrow. Do not build large rerender-prone global contexts when Valtio or local state is enough.

## Tailwind CSS 4 Rules

- Use Tailwind CSS v4 in CSS-first mode.
- Prefer `@theme` and CSS variables for tokens rather than spreading arbitrary values throughout JSX.
- There is no Tailwind config in the repo today. If config becomes necessary, keep it minimal and prefer v4 patterns over legacy JS-config habits.
- Keep class names statically discoverable by Tailwind. Map states to complete class strings instead of concatenating partial fragments or generating arbitrary class names at runtime.
- Keep utility classes readable and mostly static.
- Use `clsx`, `tailwind-merge`, and `tailwind-variants` only when composition is truly needed.
- Avoid giant utility strings that hide layout intent. Extract variants or reusable components when repetition starts.
- Avoid arbitrary values unless they map to a real design token or a measured layout requirement.
- Prefer transform- and opacity-based animation. Avoid animating layout- or paint-heavy properties.
- Keep custom CSS limited to tokens, rare layout exceptions, and complex keyframes that utilities cannot express cleanly.

### React Component Authoring Guidelines

* For new shared primitives, prefer hand-written React + Tailwind CSS + Tailwind Variants components instead of introducing another abstraction layer.
* The goal is to build a small, consistent, accessible, maintainable component system with predictable APIs and minimal styling drift.
* Write components by hand with clear structure and minimal abstraction. Do not recreate a full UI framework. Only abstract patterns that are already repeated or clearly part of the design system.
* Write the component in a single file within `src/web/ui/components`.
* Component props should be predictable across the system. Reuse the same naming conventions everywhere. Avoid one-off prop names when an existing convention already fits.
* Use Tailwind classes in a controlled way. Do not scatter long class strings across many branches. Centralize styling rules with Tailwind Variants so variants, sizes, and states are easy to inspect and extend. Tailwind Variants supports typed variants, slots, composition, and compound variants, which makes it suitable for building reusable design-system components. It also supports extending existing component definitions.
* Build small primitives that can be combined. Do not create giant "do everything" components.
* Prefer primitives and composites to stay generic. Domain-specific components should not be mixed into the base UI layer.
* Before writing JSX, define:
  - component purpose
  - required props
  - optional props
  - supported variants
  - supported sizes
  - controlled vs uncontrolled behavior
  - whether accessibility/ARIA work is intentionally out of scope
  - whether it accepts `ref`
* Start from the correct native element. Only add wrappers if necessary for layout, icons, loading indicators, descriptions, validation text, or slot composition.
* Do not add ARIA attributes, accessibility-only wrappers, or extra accessibility abstractions unless explicitly requested.
* Use a `tv` definition for the component's base styles and variants. Tailwind Variants is designed for base styles, variants, slots, compound variants, and composition/extension.
* Use VariantProps<typeof ...> for variant typing. Keep custom props minimal and explicit.
* `base` should contain only what is always true for the component.
* `variants` should express meaning, not implementation.
* If one style only applies when two or more variant conditions are combined, use `compoundVariants` instead of putting branching logic in JSX.
* For components like Card, Tabs, Dialog, or InputGroup, use Tailwind Variants slots so each internal part has a stable styling contract. Tailwind Variants explicitly supports slots for multi-part components.
* Do not build class names with large nested ternaries in JSX. Prefer `tv`, small boolean branches, helper utilities.
* Do not hardcode arbitrary values repeatedly unless there is a real one-off need. Prefer shared semantic tokens such as: radius scale, spacing scale, font sizes, color roles, shadow roles, z-index layers.
* If the component manages value, open state, selected state, or expanded state, decide explicitly whether it supports: controlled mode, uncontrolled mode, or both.
* Loading buttons, inputs, cards, and menus should not jump in size unless that is deliberate.
* Do not add an `as` prop to every component automatically. Only support polymorphism when there is a clear product need and the semantics remain valid.
* Do not use `forwardRef`. Starting in React 19, you can now access `ref` as a prop for function components.

### Reusable Component Styling Guidelines

* Base new reusable component styling on the contracts already established in `src/web/ui/components`, and only add a new visual language when the existing one genuinely does not fit.
* Define styles with a local `tv()` object named for the component, and use `slots` for multipart primitives like inputs, checkboxes, tooltips, and composed surfaces.
* Reuse the shared semantic variant names whenever they fit the component: `variant` for presentation (`solid`, `outline`, `ghost`, `flat`), `color` for intent (`primary`, `secondary`, `success`, `danger`, `warning`), and `size` for scale (`sm`, `md`, `lg`).
* When a reusable component supports semantic color, map it through a local CSS variable such as `[--color-variant:var(--primary)]` and reference that variable in the classes instead of hardcoding separate color palettes in each variant.
* Keep geometry aligned with the existing primitives: `rounded-lg` as the default surface radius, compact inline-flex or flex layouts, and the same height scale used by `Button`, `TextInput`, and `NumberInput` unless the component has a clear reason to differ.
* Treat neutral dark surfaces as the default reusable component base. Inputs and other container-like controls should stay in the `bg-neutral-900/70` to `bg-neutral-800` family, while accent colors should be reserved for semantic actions, selection, and emphasis.
* Expose `className` for single-surface components and a typed `classNames` object for multipart components. Merge overrides through `tw()` or `clsx` plus `tailwind-merge`, not by manually concatenating partial class fragments.
* Prefer boolean styling flags that already exist in the component layer, such as `fullWidth`, `disabled`, `readOnly`, and `loading`, instead of forcing callers to recreate those states with ad hoc classes.
* Disabled, read-only, and loading visuals should be handled by the component styles themselves with opacity, pointer-event, text, and background adjustments consistent with the current primitives, not by introducing separate alternate layouts.
* Keep adornments inside the shared surface with explicit props such as `startContent`, `endContent`, `label`, or slot content instead of requiring wrapper elements around every usage.
* Preserve the current focus treatment unless the component has a strong reason to differ. Existing reusable primitives generally remove default outlines and rely on the surrounding surface styling rather than adding a new ring system per component.
* If a new reusable component is action-like, start from the `Button` API and styling vocabulary. If it is field-like, start from `TextInput` or `NumberInput`, including their slot-based surface, neutral palette, and internal content layout.

## Bunshi Rules

- Name shared orchestrators `FeatureMolecule` to match the existing repository convention.
- Keep long-lived molecule state at module scope, expose actions from the molecule body, and return `{ state, ...actions } as const`.
- Use `onMount` for subscriptions, timers, and browser lifecycle wiring, and always return a cleanup function when resources were acquired.
- When shared browser state must survive reloads, persist it with `initProxy`, `storageGet`, or `storageSet` instead of ad hoc `localStorage` access inside UI components.
- Reuse `src/shared/bus` for cross-feature browser events instead of introducing another event emitter.

## Valtio Rules

- Use one proxy store per domain or feature, not one monolithic global store.
- Export mutations and actions from the store module. Shared state changes should not be scattered across random components.
- Keep ephemeral UI state local unless it is genuinely shared across features.
- Subscribe as low in the tree as possible. Call `useSnapshot` in the leaf component that renders the value.
- Do not pass full snapshots deep through the tree. Read only the fields a component needs.
- Keep expensive derived values out of hot render paths.
- Avoid storing heavy, non-serializable, or constantly changing objects in broadly observed proxies when a local ref or specialized module is better.
- Use Valtio for shared client state, not as a replacement for every piece of transient component state.

## Testing Rules

- Prefer `bun test` as the default test runner and keep all new test tooling Bun-compatible.
- Use `bun:test` directly in test files to match the existing test suite.
- Write the smallest test that proves behavior at the right boundary. Prefer focused unit tests for pure logic and targeted integration tests for framework or IO boundaries.
- Avoid brittle snapshot-heavy tests. Assert specific behavior, contract fields, accessibility state, and user-visible outcomes instead.
- Keep tests close to the code they verify unless a shared integration harness clearly benefits from a central test location.
- Keep test data small, explicit, and local to the test unless reuse clearly improves readability.
- Mock only true external boundaries such as network, filesystem, time, process, and third-party services. Do not mock internal modules when a real call path is cheap and clearer.
- Keep tests deterministic: no hidden time dependence, random inputs without fixed seeds, or shared mutable global state across tests.

### API Testing Rules

- For Bun/TypeScript API code, prefer integration-style tests around request handlers, service boundaries, serializers, and adapters instead of mocking every internal function.
- Prefer instantiating handlers and calling them directly before booting the whole Bun server when the lower-level seam already proves the behavior.
- Test both happy paths and typed failure paths, especially validation failures, malformed payloads, missing environment configuration, timeout behavior, and upstream service errors.
- Assert transport contracts explicitly: status/result shape, headers, serialized fields, error payloads, and boundary normalization behavior.
- Exercise runtime validation with realistic invalid inputs, not only well-typed test fixtures.
- Use temporary files, ephemeral directories, and isolated in-memory state for IO-heavy tests. Clean up resources and spawned processes within the test.
- Keep API tests fast by stubbing only expensive or nondeterministic edges and by avoiding unnecessary server boot when the handler or service can be invoked directly.

### UI Testing Rules

- Do not add UI tests for now.
- If a change would normally deserve UI coverage, document the testing gap in your final notes instead of introducing a UI test stack or new UI test files.

## Performance Defaults

- Optimize for fast startup, small bundles, and low rerender frequency.
- Prefer direct code over abstraction-heavy layers that increase indirection or bundle size.
- Code-split optional UI and large feature modules.
- Defer non-critical work until after the first meaningful paint or user intent.
- Avoid effect chains that trigger cascaded renders.
- Keep props small and stable at component boundaries.
- Push expensive computations out of render and off the main thread when they can block interaction.
- Before adding a library, ask whether existing Bun, React, Tailwind, Valtio, or Bunshi primitives already solve the problem.

## Quality Gates

- Keep TypeScript strict. Fix types instead of bypassing them.
- Follow Biome for both formatting and linting. Do not add Prettier or ESLint.
- Respect Biome's current guardrails in new code: no import cycles, no floating promises, throw only `Error` values, and prefer `performance.now()` over `Date.now()` for durations.
- Keep modules focused and ownership clear.
- Always add single-line comments to methods, functions, and relevant lines of code.
- Validate with the smallest relevant check before finishing: `bun run lint`, `bun run tsc`, the narrowest runtime check that exercises the changed path, and `bun run compile` when touching Bun runtime, env, or packaging code.
- Preserve Bun-first workflows in every change.

## Placement Guide

- `src/web`: page entrypoints, screens, feature composition, providers, hooks, and browser-side wiring.
- `src/web/ui`: feature-level UI, screens, and local composites.
- `src/web/ui/components`: reusable UI primitives.
- `src/web/shared`: browser-only helpers such as API/storage adapters and web utilities.
- `src/shared`: cross-layer types, constants, and utilities with minimal runtime coupling.
- `src/api`: service clients, adapters, Bun integrations, file/network/process code.

## Pre-merge Checklist For Agents

- Is the code in the correct workspace?
- Is the dependency Bun-compatible and compile-safe?
- Does the UI reuse existing `src/web/ui` patterns, Tailwind tokens, and shared primitives before adding new custom CSS or widgets?
- Does shared state belong in Valtio, local React state, or not in state at all?
- Does this change increase startup cost, binary size, or rerender frequency?
- Is there a simpler implementation with fewer dependencies and less runtime work?

### Output Requirements

Every change must:

* Compile without errors
* Have correct types
* Include necessary imports
* Be consistent with project patterns
* Be ready for production use

### Before finishing:

* Verify types
* Verify rendering behavior
* Verify state usage
* Verify consistency with existing code

Always choose the simplest correct solution.
