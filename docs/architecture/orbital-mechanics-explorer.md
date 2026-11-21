# Orbital Mechanics Explorer

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Orbital Mechanics Explorer is a tool of the Reference group and a two-body laboratory: an orbit is built from classical elements or a Cartesian state, drawn in 3D, played in time, and inspected (`api/src/orbitalmechanics.ts`, `orbitalmechanics.presets.ts`, `web/src/tools/orbitalmechanics/`).
It can load the orbit of a real minor body, start an osculating orbit from an SPK state, and compare a two-body orbit with the SPICE kernels.

## Purpose

It is an educational and analysis surface: it shows how elements shape a conic, how a body moves along it, and how far the two-body model drifts from a real ephemeris.
It is not an ephemeris, a mission planner, an orbit determination, an N-body integrator, an apparent-position calculator, or an impact predictor.

## Relations

- Uses the canonical two-body model and universal-variable solver of the toolkit (`core/src/astronomy/orbits/mechanics.ts`); the browser never solves Kepler's equation and only interpolates between the exact states the server sampled to draw.
- Resolves a minor body from SBDB through `MinorBodies` and the shared JPL queue of the [Sky Map](sky-map.md), and follows the offline switch of the [Ephemeris Chain](ephemeris-chain.md).
- Reads SPK states from one snapshot of the [SPICE Kernel Library](spice-kernel-library.md), names the kernels it used from the library's records, and points to that tool when a kernel is missing, never installing one itself.
- Opened by Explore Orbit of [Close Approaches](close-approaches.md) and of the Sky's object actions with only the body's identity; hands a minor body back to the Sky through its own selection path.
- Shares the CSV export helper `web/src/download.ts` with [Planetary Events](planetary-events.md), and exports and imports scenarios as files.
- Stateless routes: no operation, event, store, database row, or device; the tool's state lives in the tab, with a clock of its own.
- Hosted by the Tools workspace (see [Tools Integration](tools-integration.md)).

## Rules and Limitations

- Every trajectory is two-body motion about one center with no perturbation, and the tool never says otherwise; a sourced preset is accurate near its epoch only.
- All orbits of a scene share one center, one set of axes, and one clock; orbits about different centers are never drawn together.
- Only the lookup of a minor body asks JPL, never while offline; every other computation works offline.
- An angle a geometry leaves undefined is reported as undefined, never as zero, and every number answered is finite.
- A comparison with SPICE belongs to one library generation and is never patched by another source; its residual is a difference between two models, not an uncertainty or an impact prediction.
- It changes no other tool's state: not the Sky's time, the site, the profile, the SPICE library, or any device.
- Not provided: satellites from SGP4 elements, which are not osculating elements; maneuvers, transfers, perturbations, N-body integration, covariance, and orbit determination.
