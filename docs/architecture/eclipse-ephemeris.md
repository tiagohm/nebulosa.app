# Eclipse Ephemeris

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

What the [Lunar Eclipse Map](lunar-eclipse-map.md) and the [Solar Eclipse Map](solar-eclipse-map.md) share on the server (`api/src/eclipses.ts`): how an eclipse is found, refined, and named, and the one ephemeris every computation of an eclipse reads.

## Purpose

Contacts, maps, and local circumstances of one eclipse must agree with each other, or a place could appear inside a path whose contacts it never sees.
This module gives both eclipse tools one source of the Sun, the Earth, and the Moon per eclipse, and one convention for naming and stepping eclipses.

## Relations

- Uses the eclipse series and refinements of the toolkit (`core/src/astronomy/events/eclipse/`), which also produce the geographic geometry drawn on the [World Map](world-map.md).
- Takes the Sun, the Earth, and the Moon from the fast [Ephemeris Chain](ephemeris-chain.md) without Horizons: the kernels of the [SPICE Kernel Library](spice-kernel-library.md) when they cover the eclipse, else the analytical theories.
- Answers carry the provenance of their ephemeris, and results are cached by source and kernel generation.
- Used by the routes of both eclipse maps; no map library is added.

## Rules and Limitations

- The id, the type, and the times of an eclipse are those of the refined eclipse, and stepping compares refined instants.
- One computation never mixes sources: a state the kernels miss reruns it whole on the theories.
- Because the theories always exist, an eclipse is never unavailable.
- A change of the kernels computes cached eclipses again.
- Accuracy is validated against the NASA catalogs; a small residual of the solar greatest eclipse remains unexplained.
