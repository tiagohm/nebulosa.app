---
name: cqa
description: Architecture and code quality audit of Nebulosa followed by safe refactoring of the confirmed problems. Scoped by path or area, and keeps a ledger so repeated runs continue instead of starting over.
argument-hint: '[path | area | all] (empty: the next area due in the ledger)'
disable-model-invocation: true
---

# Code Quality Audit

Audit a part of Nebulosa for structural and code quality problems, fix the confirmed ones that can be fixed safely, and record the rest in the ledger so the next run continues where this one stopped.

The goal is the largest gain in structure and maintainability for the smallest added complexity and risk, not the largest number of changes. A direct, well-typed, cohesive solution beats a sophisticated one without concrete benefit. Do not assume a decision is right because it is implemented, and do not replace a valid decision with a personal preference.

`AGENTS.md` governs everything it covers: workspace boundaries, the `core` submodule, dependencies, style, documentation comments, tests, verification, and commits. This skill only adds what is specific to an audit. The visual and presentation consistency of `web/` belongs to `/ui-standardization`; here `web/` is audited for architecture, state, lifecycle, typing, and dead code.

## Scope

`$ARGUMENTS` selects what this run covers:

- One or more paths (`api/src/guiding.ts`, `web/src/equipment-control`): audit them in depth, plus the contracts they use and their consumers as far as needed to judge them.
- An area named in the ledger's coverage table: the same as its paths.
- `all`: a breadth pass over every workspace, aimed at cross-cutting problems (boundaries, duplicated models, dead modules, configuration). Report which areas need a deep pass instead of pretending to have done one.
- Empty: the area of the ledger's suggested order that was never audited, else the one audited longest ago. Say which one you chose before starting.

An area audited thoroughly is worth more than the whole repository skimmed. Never claim coverage of code that was not actually read.

## Ledger

[ledger.md](ledger.md) persists between runs. Read it first:

- **Coverage**: when each area was last audited, at which commit, and how deeply.
- **Pending**: confirmed problems not yet fixed. Re-verify each one against the current code before acting on it: it may be fixed, moved, or obsolete.
- **Decided**: findings deliberately left as they are, with the reason. Do not raise one again unless the code it depends on changed, and then say what changed.
- **Core**: problems whose fix belongs in `nebulosa.ts`.

At the end of the run, update it: the coverage row of the area (date, `git rev-parse --short HEAD`, depth), remove the items fixed (their commits record them), and add the new pending, decided, and core items. Keep each entry short: location, evidence, impact, proposed fix. The ledger is local and untracked; never stage it.

## Before Starting

1. Read `AGENTS.md`, the core of `docs/ARCHITECTURE.md`, and the documents under `docs/architecture/` that own the area. They are the contract the code must meet, not proof that it does.
2. Inspect `git status --short` and preserve existing changes.
3. Record a baseline: run the tests that cover the area and `bun lint`, so pre-existing failures are not attributed to this run.

## What to Look For

A clean `bun lint` says nothing about any of this.

**Architecture and responsibilities.** Violations of the boundaries between workspaces and layers; responsibilities in the wrong module; modules or components that accumulate too much; circular dependencies and excess coupling; duplicated state and conflicting sources of truth; code that bypasses an existing contract; business logic in the UI; abstractions that are inconsistent, unnecessary, or misplaced; service interfaces more complex than their use. Ask whether another developer would know where a feature belongs and how it relates to the rest.

**Readability.** Files or functions mixing distinct responsibilities, deep nesting, convoluted control flow, too many parameters, ambiguous or inconsistent names, magic constants, stale or misleading comments, clever code that hides intent. Split only when cohesion and navigation actually improve; there is no size rule.

**Workarounds.** Casts, `any`, `!`, and suppressions that cover a modeling problem; `try/catch` that swallows failures; fallbacks that hide real errors; reliance on incidental behavior; temporary fixes that became permanent; logic duplicated to avoid fixing an abstraction; coupling to library internals; timeouts, delays, polling, and retries that paper over a synchronization problem. Fix the root cause instead of polishing the workaround.

**Dead code.** Unused files, exports, components, hooks, stores, routes, handlers, state, props, parameters, dependencies, scripts, configuration, and assets; superseded implementations; compatibility shims without consumers; commented-out code; stale TODOs. Before removing anything, check every real reference path: registries, dynamic imports, workers, scripts, entry points, tests, and the `bin` generators. A text search without hits is not enough, and an intentional extension point or planned feature is not dead code.

**React and state** (`web/`). Effect dependencies; listeners and subscriptions without cleanup; stale closures; races between React state, Valtio, and server events; derived state stored instead of computed; components coupled to infrastructure; unmounting that cancels work the server owns. Presentation stays decoupled from operations.

**Backend, operations, and resources** (`api/`). Lifecycle of services and operations; concurrency, cancellation, and error propagation; leaked listeners, timers, handles, workers, and sockets; disconnection and reconnection; integrity of snapshots and WebSocket events; consistency of HTTP contracts and status codes; unawaited promises; races and deadlocks; operations that can leave hardware or resources inconsistent. Give particular attention to `OperationRegistry`, sessions, leases, `ImageStore`, `AnalysisScheduler`, device control, and the frontend mirror of server state. Input validation is intentionally absent (`AGENTS.md`); do not report it.

**Types and modeling.** Imprecise types; states a discriminated union would make unrepresentable; invariants the types do not carry; unsafe conversions; duplicated models; public contracts that admit invalid parameter combinations; generics more complex than the problem. In scientific code, preserve units, reference frames, coordinate conventions, epochs, and numerical precision.

**Tests, configuration, and documentation.** Critical behavior without coverage; risky spots without a regression test; brittle tests coupled to implementation details; duplicated or contradictory configuration; obsolete scripts; differences between `bun dev` and the executable; architecture documents that no longer describe the code. Do not add tests to inflate a count.

## Classification

- **P0**: an integrity, safety, or functional failure, including hardware left in an unsafe state.
- **P1**: a likely bug or a significant architectural risk.
- **P2**: concrete debt that hinders change, testing, or maintenance.
- **P3**: a local improvement in clarity or consistency.

For each finding establish the exact location, the evidence in the code, the root cause, the practical consequence, the fix, and the risk of the fix. A style preference is not a finding.

## Fixing

This is an implementation task. Fix the confirmed problems that can be fixed safely, the most impactful first:

- Fix the root cause. Change the existing structure before adding an abstraction, and centralize only for a concrete architectural reason.
- Preserve APIs, contracts, and behavior, those of device control and astronomical operations above all.
- No cosmetic refactors, no reformatting of whole files, no compatibility layer for an implementation without consumers.
- One commit per conceptually independent change, following `AGENTS.md`, with the owning architecture document updated in the same commit when a contract changes.

Do not improvise when a fix needs a broad restructuring, a product decision, a change of public contract, or a change in `core`: record it in the ledger (Pending or Core) with its benefits, risks, and the recommended sequence.

## Verification and Review

Run the verification `AGENTS.md` requires for what changed. Compiling is not enough: confirm the behavior is preserved.

Then review the whole diff critically. Did the code become simpler, or was the complexity only moved? Was an unnecessary abstraction introduced? Are the contracts intact? Would a new developer understand it at once? Revert any change without a concrete benefit.

## Report

Concise, in the user's language:

1. **Scope and coverage**: what was audited, how deeply, and what was not examined.
2. **Assessment**: strengths, weaknesses, and risks of the area.
3. **Findings**: a table of severity, category, location, evidence, impact, and status: **fixed** (with its commit), **pending**, or **not confirmed**.
4. **Changes**: what was done, why, and the benefit.
5. **Pending**: in priority order, with why each could not be fixed safely.
6. **Validation**: the commands run and their results, separating pre-existing failures from introduced ones, and naming anything not run and why.
7. **Next**: the area the ledger now suggests for the next run.
