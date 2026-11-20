# Eclipse Ephemeris Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

What the [Lunar Eclipse Map](lunar-eclipse-map.md) and the [Solar Eclipse Map](solar-eclipse-map.md) share on the server: how their maps are drawn and the one ephemeris every computation of an eclipse reads.

- Eclipse maps: computed in `api` from `core/src/astronomy/events/eclipse/*`, which produce geographic geometry and SVG paths, drawn on `WorldMap` (see [World Map Contract](world-map.md)).
  No map library is added.
- Eclipse ephemeris (`api/src/eclipses.ts`): the toolkit's series find an eclipse and `refineSolarEclipse` and `refineLunarEclipse` fix it, so the id, the type, and the times of a response are those of the refined eclipse.
  Every computation of one eclipse takes the Sun, the Earth, and the Moon from one source (`eclipseEphemeris`), so its contacts, maps, and local circumstances agree:
  the kernels of the SPICE Kernel Library (see [SPICE Kernel Library Contract](spice-kernel-library.md)) when they resolve the Sun (10), the Earth (399), and the Moon (301) at the greatest eclipse and a day and a half on either side, else the analytical theories (VSOP87E and ELPMPP02); either source is interpolated (`interpolatedEphemerisSource`) and read through `sunMoonPositionOf` of the toolkit.
  This is the fast [Ephemeris Chain](ephemeris-chain.md) without Horizons, so an eclipse is never unavailable; the map and local answers carry its provenance (`ephemeris`).
  The kernel snapshot is read once per request, and once per candidate of a visible-only search, and evaluated synchronously; a state the kernels miss inside a computation reruns it whole on the theories, so sources are never mixed.
  Results are cached by source and kernel generation, so a change of the kernels computes them again.
  On de440s the greatest eclipses and contacts are about 0.1 s from the theories' (up to 0.2 s for local contacts), gamma and magnitudes within 2·10⁻⁵, and the types equal, while a new eclipse is found and refined faster, since no ELPMPP02 node is evaluated.
  Stepping compares refined instants, never the series' ones (`findRefinedEclipse`), and the lunar series also hands the refinement candidates slightly below magnitude 0 (`SERIES_PENUMBRAL_MARGIN` of `api/src/lunareclipses.ts`), which finds the faintest penumbral eclipses.
  Measured against the NASA catalogs for 2001–2100: solar greatest eclipse within 26 s and gamma within 0.0001; lunar greatest eclipse within 3 s, magnitude within 0.0003, and types all equal.
  The solar residual is not explained, and NASA's series differs from ELPMPP02.
  Local solar contacts are within 5 s of a DE421 oracle, with the smooth limb and NASA's k2 = 0.272281.
