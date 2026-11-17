---
name: ui-standardization
description: Behavior-preserving audit and refactor of the Nebulosa frontend for component reuse, consistent numerical and astronomical formatting, and visual consistency. Changes only web/. Scoped by path, feature, or formatting, and keeps a ledger so repeated runs continue instead of starting over.
argument-hint: '[path | feature | formatting | all] (empty: the next area due in the ledger)'
disable-model-invocation: true
---

# UI Standardization

Make a part of the frontend read as if one team had designed it from the start: shared primitives reused, equivalent quantities formatted the same way, and equivalent elements looking and behaving the same. This is a behavior-preserving refactor, not a redesign: the same shell, visual identity, information density, and operational behavior.

Prefer simplification over new layers. A little explicit duplication beats an abstraction that hides behavior. Optimize for clarity and consistency, not for files touched or lines deleted.

`AGENTS.md` governs style, the frontend conventions (named function components, Tailwind, `tv`, `cn`, Valtio for shared state, no `aria-*`, buttons without `size="sm"`), documentation comments, tests, verification, and commits. Architecture, lifecycle, and backend problems belong to `/cqa`: record any found here in the ledger's Outside section instead of fixing them.

## Boundaries

- Modify only files under `web/`, plus this skill's [ledger.md](ledger.md).
- Never change backend behavior, routes, WebSocket contracts, device commands, start, stop, abort, or cancel semantics, capture lifecycles, session and operation tracking, persistence semantics or stored preferences, scientific calculations, navigation, or keyboard shortcuts.
- No new dependency, UI framework, global state system, or design system: consolidate the existing one.
- A functional difference is allowed only as the fix of an actual frontend defect, and is reported as such.
- Restructuring JSX must not reset UI state, replace a draft, duplicate a subscription, or trigger an extra operation: keep keys, component identity, and state ownership stable. Watch camera, mount, guiding, acquisition, and long-running operations above all.

What needs a change outside `web/` goes to the ledger's Outside section as a recommendation.

## Scope

`$ARGUMENTS` selects what this run covers:

- One or more paths or features (`web/src/sky`, `equipment-control`): audit and migrate them in depth, with the shared primitives they use.
- `formatting`: the formatting pass over the whole frontend (see Formatting).
- `all`: a breadth pass over every feature for cross-cutting inconsistencies and primitives worth consolidating. Report which areas need a deep pass instead of pretending to have done one.
- Empty: the area of the ledger's suggested order that was never audited, else the one audited longest ago. Say which one you chose before starting.

Cover the whole of the chosen area; do not stop after the first few components. Never claim coverage of code that was not actually read.

## Ledger

[ledger.md](ledger.md) persists between runs. Read it first:

- **Conventions**: the semantic formatter and presentation adopted for each quantity and recurring pattern. Apply them; change one only deliberately, and then migrate all its uses.
- **Coverage**: when each area was last audited, at which commit, and how deeply.
- **Pending**: confirmed inconsistencies not yet fixed. Re-verify each one against the current code before acting on it.
- **Decided**: differences deliberately kept, such as a legitimate feature-specific presentation, with the reason. Do not raise one again unless the code it depends on changed.
- **Outside**: recommendations that need changes outside `web/`.

At the end of the run, update it: the coverage row of the area (date, `git rev-parse --short HEAD`, depth), the conventions adopted, the items fixed removed, and the new pending, decided, and outside items. Keep entries short. The ledger is local and untracked; never stage it.

## Before Starting

1. Read `AGENTS.md`, the core of `docs/ARCHITECTURE.md`, `docs/architecture/ui-and-layout.md`, and the document of each feature in scope.
2. Inventory the primitives of `web/src/ui/` and `web/src/layout/` and the formatters of `web/src/format.ts` and its tests before proposing anything new, and find the consumers of any primitive you will change.
3. Inspect `git status --short` and preserve existing changes.
4. Record a baseline: the `web` tests and `bun lint`, so pre-existing failures are not attributed to this run.

## What to Look For

Look beyond exact duplication for conceptual duplication: different components presenting the same thing in slightly different ways. Distinguish a legitimate feature-specific difference from an accidental inconsistency.

- **Components.** Duplicate or near-duplicate components; repeated layout fragments (section headers, field groups, label and value pairs, metrics, status and progress summaries, action groups, empty, error, and loading states, device and session summaries, result panels, tables); components with too many responsibilities; unused props and components; redundant wrappers and deep trees; inconsistent use of the shared primitives.
- **React.** Unnecessary state or effects, derived state stored instead of computed, effects without cleanup, expensive work in render, avoidable re-renders, repeated fetch calls, repeated event or form handling, conditional rendering more complex than needed.
- **States.** Inconsistent loading, empty, disabled, and error presentation, and missing measurements shown as values.
- **Visual consistency.** Typography and hierarchy, labels, spacing, grid and flex, button weight, input heights and alignment, section headers, panel structure, table density and alignment, metric presentation, icon sizes, badge and status colors, borders and radii, tooltips, dialog and popover layouts. Use the existing tokens, never an arbitrary color or an isolated magic number.
- **Responsive layout.** Horizontal scrolling, clipped or overlapping content, toolbar wrapping, long labels and values, wide tables, modal sizes, scroll regions, image viewers and their controls, and status bar density, at narrow and intermediate widths. Keep the existing responsive architecture.

Extract a component only for a genuinely reusable responsibility. Prefer composition over configuration props; no universal component with dozens of optional props, generic factory, or configuration-driven renderer. Feature-specific components stay with their feature and shared primitives go in `web/src/ui/`. When consolidating, migrate every consumer and delete the superseded implementation.

## Formatting

The highest priority of the skill. Audit inline `toFixed` and `toPrecision`, `Intl.NumberFormat`, string concatenation, and local helpers, and consolidate equivalent ones into the semantic formatters of `web/src/format.ts` or the pure formatting functions of the toolkit, which `web` may import. Prefer one domain function per quantity over a generic helper with boolean options, and do not wrap a formatter that already fits.

The quantities include RA, declination, altitude and azimuth, hour angle, sidereal time, latitude and longitude, angular distance, position angle, arcminutes and arcseconds, pixel scale, time, duration, timestamps, JD and MJD, exposure, distance, velocity, temperature, percentage, magnitude, RMS, HFR, FWHM, other image metrics, and device readings.

- RA is in hours: never format it as a degree angle. Hour angle, RA, sidereal time, civil time, and duration are distinct quantities. RA, declination, azimuth, and a mechanical rotator angle do not share a format just because they are angles.
- Normalize and wrap at the valid range of each quantity, and keep the sign of a signed value, including a negative value that rounds to zero.
- Sexagesimal rounding carries into minutes, degrees, and hours, and wraps at the end of the range.
- Units are explicit and consistent, following the existing convention.
- Precision reflects the data and the instrument and never implies more. The user's coordinate format preferences keep working.
- A missing, `NaN`, or non-finite value shows as unavailable, never as zero.
- Format only for display: keep raw numbers in state, never round before a further computation, and keep parsing, validation, and formatting separate. An input keeps what the user typed.
- Respect the existing time zone, UTC, locale, and time scale conventions, and never change a reference frame or epoch.

## Verification and Review

Run the verification `AGENTS.md` requires for UI changes, with tests where a refactor could regress:

- Formatting: RA and declination, sexagesimal carry, wrapping, negative values near zero, precision, `undefined`, `NaN`, and non-finite values, units, and durations.
- Shared UI behavior: state preservation, drafts, disabled and loading states, and missing measurements.

Format only the touched files (`bun fmt <paths>`). Run `bun dev` and inspect every touched screen in the browser, at a narrow width too; never claim a visual check that was not made. Confirm `git diff --name-only` lists only `web/`.

Then review the whole diff for accidental behavior changes in every touched feature, and revert any change without a concrete benefit.

## Report

Concise, in the user's language:

1. **Scope and coverage**: what was audited, how deeply, and what was not examined.
2. **Changes**: components created, improved, or consolidated; implementations removed; features migrated; visual consistency fixes.
3. **Formatting**: the conventions adopted per quantity.
4. **Validation**: the commands run and their results, the screens checked in the browser, separating pre-existing failures from introduced ones, and naming anything not run and why.
5. **Pending**: the remaining debt and why it was not addressed.
6. **Outside**: recommendations that need changes outside `web/`.
7. **Scope check**: confirmation that only `web/` changed.
8. **Next**: the area the ledger now suggests for the next run.
