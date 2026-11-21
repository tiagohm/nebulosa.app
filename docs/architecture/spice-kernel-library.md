# SPICE Kernel Library

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The SPICE Kernel Library is one server-global set of SPK ephemeris files, shared by every profile and tab, and a tool of the Reference group that manages it (`api/src/spicekernels.ts` with `spicekernels.catalog.ts`, `spicekernels.store.ts`, `spicekernels.runtime.ts`, `spicekernels.jobs.ts`, `spicekernels.mpc.ts`, `spicekernels.elements.ts`, and `web/src/tools/spicekernels/`).
The tool lists the installed kernels and their precedence, explains which kernel gives each body, evaluates a state, and acquires new kernels.

## Purpose

The analytical theories give positions everywhere, but SPK kernels give the most accurate positions of planets, moons, and small bodies.
The library lets the operator choose which kernels the server computes with, so every position, event, eclipse, and planner of Nebulosa can use them, and lets them add small bodies the curated files do not hold.

## Relations

- Acquires files only by explicit acts of the operator: a curated NASA/JPL download, a Horizons generation through the shared JPL queue, an integration of an MPC orbit or of MPC asteroid elements (a file or an MPC list) with the toolkit's propagator, or an upload.
- Uses the toolkit (`core`) to read, inspect, select, evaluate, and write SPK files.
- Stores the files in the data directory, and their records, preferences, and photometry in the operational database (see [Persistence and State](persistence-and-state.md)).
- Publishes immutable generations of the kernel set, read by every computation of positions through the [Ephemeris Chain](ephemeris-chain.md), whose offline switch belongs to its snapshot and is edited in Settings, not in the tool.
- Its users include the [Sky Map](sky-map.md) (which also draws the small bodies of its generated kernels and their magnitudes), the [Observing Planner](observing-planner.md), the [Jupiter Observing Planner](jupiter-observing-planner.md), the [Saturn Observing Planner](saturn-observing-planner.md), [Planetary Events](planetary-events.md), the [Eclipse Ephemeris](eclipse-ephemeris.md), and the [Orbital Mechanics Explorer](orbital-mechanics-explorer.md), which points to the library when a kernel is missing.
- Publishes change and job events through the event dispatcher, so acquisitions also reach [Notifications](notifications.md); the web mirrors the library in `SERVER_STORES`.
- Acquisitions run as server jobs that outlive tabs but not a restart; no device is involved.
- Hosted by the Tools workspace (see [Tools Integration](tools-integration.md)).

## Rules and Limitations

- No position, event, or locator request ever downloads, generates, or resolves a kernel remotely.
- A change prepares a complete new generation before it replaces the current one, and a calculation evaluates one generation synchronously, so it never mixes generations or reads a closed file; a failure keeps the previous generation.
- Precedence follows the load order, refined per body by an operator's preference, which never opens a coverage gap.
- A system barycentre is never taken for its planet, an unsupported selected segment makes its body unavailable, and coverage is never extrapolated.
- A kernel whose centers no enabled kernel provides is not ready until one does; nothing is downloaded for it.
- A generated small-body kernel covers a whole number of months from today and is only as current as the orbit it came from; generating it again is explicit.
- A corrupt file never stops the server.
- Not provided: kernels other than SPK, frames other than J2000, unsupported SPK data types, catalog discovery beyond the curated entries, automatic updates, and spacecraft.
