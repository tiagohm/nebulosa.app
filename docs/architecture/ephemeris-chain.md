# Ephemeris Chain

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Ephemeris Chain is how every computation of solar-system positions in the server chooses its source (`api/src/ephemeris.chain.ts`): the SPK kernels of the [SPICE Kernel Library](spice-kernel-library.md), the analytical theories of the toolkit (with a two-body orbit of SBDB elements for a minor body), and JPL Horizons, tried in the order of a mode.
The `fast` mode (maps, planners, events, eclipses, almanacs, dense sweeps) tries the kernels, the theories, then Horizons; the `accurate` mode (the selected object of the Sky, mount targets) tries the kernels, Horizons, then the theories.

## Purpose

Positions must be as accurate as the installed kernels allow, yet never unavailable when a kernel or the network is missing.
The chain gives every feature one rule for that trade-off, so results agree across tools and always say where they came from.

## Relations

- Builds on the `EphemerisSource` abstraction of the toolkit (`nebulosa/src/astronomy/ephemeris/source`), over which both the kernels and the theories are written, with an interpolated wrapper for computations that sample many instants.
- Reads the current generation of the SPICE Kernel Library, and its offline switch, stored with the library and edited in Settings, Ephemeris Sources.
- Asks Horizons through the shared JPL queue of the [Sky Map](sky-map.md), with a circuit breaker per service.
- Used by the Sky positions and events, mount slews, the [Jupiter Observing Planner](jupiter-observing-planner.md), the [Saturn Observing Planner](saturn-observing-planner.md), [Planetary Events](planetary-events.md), the [Eclipse Ephemeris](eclipse-ephemeris.md), the minor bodies and nights of the [Observing Planner](observing-planner.md), [Astro Weather](astro-weather.md) nights, the [Sun Inspector](sun-inspector.md) and [Moon Inspector](moon-inspector.md), [Artificial Satellites](artificial-satellites.md), [Meteor Showers](meteor-showers.md), [iPolar](ipolar.md), and the [Mount Pointing Model](mount-pointing-model.md).
- [Close Approaches](close-approaches.md) and the [Orbital Mechanics Explorer](orbital-mechanics-explorer.md) follow its offline switch.

## Rules and Limitations

- One computation takes all its states from one source; a state the kernels miss discards the computation, which runs whole on the next source.
- A computation offers only the sources it can use: dense sweeps never offer Horizons, and a minor body without elements offers no theory.
- No computation of the server calls a theory directly.
- While the offline switch is on, no automatic request reaches JPL; downloading or generating a kernel, explicit acts of the operator, still use the network.
- A semantic failure of Horizons is reported as is, never replaced by another source.
- Every result carries its provenance (the source, the mode, the kernels and their generation, and the sources tried before it), and cached results are keyed by source and generation, so a change of the kernels or the offline switch computes them again.
- The series of the toolkit only seed events that are refined on the chosen source.
