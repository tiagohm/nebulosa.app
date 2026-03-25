# AGENTS.md

## Overview

This is a TypeScript back-end and front-end for Astronomical software. It includes tools for observation planning, telescope control, and image capturing, processing and visualization.

The project uses **Bun** as runtime, package manager, builder, and test runner, ESM modules only.

## Project Structure

* `src`: Project files.
  - `api`: Back-end files. Bun's route-based endpoints.
  - `web`: Front-end files. React components.
    - `assets`: Image files.
    - `hooks`: React hook files.
	- `molecules`: Bunshi molecules for state management and component logic.
	- `pages`: Start pages for routes. Actual, only the home page.
	- `shared`: Shared files for web.
	- `ui`: React components.
  - `shared`: Shared files between `api` and `web`. Pure TypeScript functions only (no native/browser dependencies).
* `tests`: Tests files.
* `data`: Data files for `tests`, `api` or `web`.

## Rules

* Follow existing patterns in the repository. Do not invent new ones.
* Make minimal, localized changes.
* Prefer clarity over abstraction.
* Deliver complete, production-ready code (no TODOs, no placeholders).
* Do not break existing behavior unless explicitly required.

### Typescript

* Use strict typing at all times.
* Do NOT use `any` (unless unavoidable and justified).
* Prefer `unknown` over `any`.
* Fully type:
  - function params
  - returns only for structured types
  - component props
  - hooks and stores
* Avoid unsafe casts (`as unknown as` is forbidden).
* Model domain explicitly; do not duplicate types.
* Handle `null` / `undefined` explicitly.
* Prefer `interface` over `type`. Use readonly tuples instead if appropriate.
* If precision trade-offs are introduced, they must be documented.
* Avoid unnecessary allocations inside hot paths.
* Prefer mutable vector utilities when performance critical.
* Avoid object churn.
* Prefer flat numeric structures over nested objects.
* Prefer TypedArrays for large datasets.
* Do not replace optimized loops with functional abstractions if performance degrades.
* Minimize install dependencies.
* Before adding a dependency, verify Bun-native support.
* Avoid new allocations in loops.
* Avoid closures in tight loops.
* Avoid JSON operations.
* Avoid dynamic object reshaping.
* Always single-line comment methods and important lines.
* Use `readonly` where appropriate.
* Prefer global pure functions over local arrow functions.
* Prefer destructuring.

### React

* Use functional components only.
* Keep components small and focused.
* Do NOT put business logic inside JSX.
* Avoid unnecessary `useEffect`.
  - If it can be derived, do NOT store it.
* Effects must be:
  - necessary
  - correctly dependency-bound
  - cleaned up
* Avoid unnecessary re-renders.
* Do NOT mutate props.
* Use stable keys (never index if order can change).

### Hooks

* Hooks must be predictable and well-typed.
* Do NOT mix unrelated responsibilities.
* Do NOT call hooks conditionally.
* Only extract hooks when it improves reuse or clarity.

# State (valtio)

* Use valtio ONLY for shared/global state.
* Prefer local state for UI-only logic.
* Stores must be domain-focused.
* Do NOT create a global monolithic store.
* Do NOT mutate state arbitrarily across the app.
* Do NOT store derived values.
* Use `useSnapshot` selectively (read minimal state, prefer destructuring).

### Components

* One responsibility per component.
* Prefer composition over large configurable components.
* Props must be minimal, explicit, and typed.
* Do NOT pass props blindly.
* Extract subcomponents only when it improves readability.
* Always memoize components without parameters. Avoid if merely aesthetic.
* Compose components by logic.

### HeroUI

* Use HeroUI as the default UI layer.
* Do NOT reimplement components that already exist.
* Do NOT break built-in accessibility.
* Customize using official APIs (no CSS hacks).
* Keep wrappers thin and transparent.

### Tailwind

* Use Tailwind as the primary styling system.
* Avoid custom CSS unless necessary.
* Do NOT overuse arbitrary values.
* Keep class lists clean and consistent.
* Ensure responsiveness from the start.

### Performance

* Optimize only when needed.
* Avoid unnecessary renders.
* Read minimal state per component.

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
